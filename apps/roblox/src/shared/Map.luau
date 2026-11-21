--!nonstrict
-- The Depot as geometry, ported from packages/sim/src/map.ts: the questions the simulation and the client ask
-- about the building (can I stand here, can I see that, how do I walk there) and the wall and floor pieces the
-- world is built from. Metres; x runs east and z runs south, as on the web. Loop orders match the JS so routes
-- break ties the same way.

local Data = if script then require(script.Parent.Data) else (require :: any)("./Data")
local Util = if script then require(script.Parent.Util) else (require :: any)("./Util")

export type Point = { x: number, z: number }
export type Doors = { [string]: boolean }

local hypot = Util.hypot
local trunc = Util.trunc

local Map = {}

Map.PLAYER_R = Data.PLAYER_R
Map.MASCOT_R = Data.MASCOT_R
Map.EYE = Data.EYE
Map.DOOR_H = Data.DOOR_H
Map.BOOTH = Data.BOOTH
Map.DUCTS = Data.DUCTS
Map.ROOMS3 = Data.ROOMS3
Map.DOORWAYS = Data.DOORWAYS
Map.BOXES = Data.BOXES
Map.GENERATOR = Data.GENERATOR
Map.CHARGER = Data.CHARGER
Map.WALL_MAP = Data.WALL_MAP
Map.PANELS = Data.PANELS
Map.BATTERY_SPOTS = Data.BATTERY_SPOTS
Map.HIDES = Data.HIDES
Map.REST = Data.REST
Map.EXTRA_NODES = Data.EXTRA_NODES

-- Copied so addObstacle cannot change the generated data.
local OBSTACLES: { { number } } = table.clone(Data.OBSTACLES)
Map.OBSTACLES = OBSTACLES

local ROOMS3 = Data.ROOMS3
local DOORWAYS = Data.DOORWAYS
local DUCTS = Data.DUCTS
local MASCOT_R = Data.MASCOT_R

function Map.spawnPoint(i: number): { x: number, z: number, yaw: number }
	-- i is 0-based, the guard's place in join order.
	return { x = 18.5 + (i % 4) * 1.6, z = 41.5 - math.floor(i / 4) * 1.4, yaw = math.pi }
end

local resetNav: () -> ()

function Map.addObstacle(x0: number, z0: number, x1: number, z1: number)
	table.insert(OBSTACLES, { x0, z0, x1, z1 })
	resetNav()
end

--[[ standing and seeing ]]

local function shutDoor(d: any, doors: Doors?): boolean
	return d.key ~= nil and doors ~= nil and doors[d.key] == true
end

-- The obstacles sorted into two-metre squares of floor, so walkable() only asks about the few near its point.
local CELL, COLS = 2, 24
local buckets: { [number]: { { number } } }? = nil
local function bucketObstacles()
	local out: { [number]: { { number } } } = {}
	for _, o in OBSTACLES do
		for cz = trunc((o[2] - 1) / CELL), trunc((o[4] + 1) / CELL) do
			for cx = trunc((o[1] - 1) / CELL), trunc((o[3] + 1) / CELL) do
				local key = cz * COLS + cx
				local list = out[key]
				if not list then
					list = {}
					out[key] = list
				end
				table.insert(list, o)
			end
		end
	end
	return out
end

local lastRect = ROOMS3[1].rects[1]
-- Can a circle of radius r be centred here? doors: S.doors, or nil to ignore shut doors.
-- over: ignore the furniture, for questions about reaching across it.
local function walkable(x: number, z: number, r: number, doors: Doors?, over: boolean?): boolean
	local inside = x >= lastRect[1] + r and x <= lastRect[3] - r and z >= lastRect[2] + r and z <= lastRect[4] - r
	if not inside then
		for _, room in ROOMS3 do
			for _, rect in room.rects do
				if x >= rect[1] + r and x <= rect[3] - r and z >= rect[2] + r and z <= rect[4] - r then
					inside = true
					lastRect = rect
					break
				end
			end
			if inside then
				break
			end
		end
	end
	if not inside then
		for _, d in DOORWAYS do
			if not shutDoor(d, doors) then
				local x0, z0, x1, z1 = d.rect[1], d.rect[2], d.rect[3], d.rect[4]
				local along = r + 0.06
				local ok
				if d.axis == "x" then
					ok = x >= x0 - along and x <= x1 + along and z >= z0 + r and z <= z1 - r
				else
					ok = z >= z0 - along and z <= z1 + along and x >= x0 + r and x <= x1 - r
				end
				if ok then
					inside = true
					break
				end
			end
		end
	end
	if not inside then
		return false
	end
	if over then
		return true
	end
	if not buckets then
		buckets = bucketObstacles()
	end
	local near = (buckets :: any)[trunc(z / CELL) * COLS + trunc(x / CELL)]
	if near then
		for _, o in near do
			if x > o[1] - r and x < o[3] + r and z > o[2] - r and z < o[4] + r then
				return false
			end
		end
	end
	return true
end
Map.walkable = walkable

-- Move a circle by (dx, dz), sliding along whatever it meets. Changes p.x and p.z and returns how far it got as a
-- fraction of what was asked.
function Map.slide(p: any, dx: number, dz: number, r: number, doors: Doors?): number
	local len = hypot(dx, dz)
	if len == 0 then
		return 1
	end
	local steps = math.ceil(len / (r * 0.5))
	local sx, sz, x0, z0 = dx / steps, dz / steps, p.x, p.z
	for _ = 1, steps do
		if walkable(p.x + sx, p.z + sz, r, doors) then
			p.x += sx
			p.z += sz
		elseif sx ~= 0 and walkable(p.x + sx, p.z, r, doors) then
			p.x += sx
		elseif sz ~= 0 and walkable(p.x, p.z + sz, r, doors) then
			p.z += sz
		else
			break
		end
	end
	return hypot(p.x - x0, p.z - z0) / len
end

-- Is the straight line between two points clear for something of radius r? With r near 0 this is line of sight.
local function clear(ax: number, az: number, bx: number, bz: number, r: number, doors: Doors?, over: boolean?): boolean
	local len = hypot(bx - ax, bz - az)
	local steps = math.max(1, math.ceil(len / 0.35))
	for i = 0, steps do
		local t = i / steps
		if not walkable(ax + (bx - ax) * t, az + (bz - az) * t, r, doors, over) then
			return false
		end
	end
	return true
end
Map.clear = clear

function Map.sees(ax: number, az: number, bx: number, bz: number, doors: Doors?): boolean
	return clear(ax, az, bx, bz, 0.04, doors)
end
-- Could an arm get from here to there? Walls and shut doors stop it. Furniture does not.
local function reaches(ax: number, az: number, bx: number, bz: number, doors: Doors?): boolean
	return clear(ax, az, bx, bz, 0.04, doors, true)
end
Map.reaches = reaches

-- Can any of a body of radius r standing at b be seen from a? See packages/sim/src/map.ts for the reasoning.
local GLIMPSE = 0.25
function Map.glimpses(ax: number, az: number, bx: number, bz: number, r: number, doors: Doors?): boolean
	if reaches(ax, az, bx, bz, doors) then
		return true
	end
	local d = hypot(bx - ax, bz - az)
	if d == 0 then
		d = 1
	end
	local ux, uz, n = -(bz - az) / d, (bx - ax) / d, math.ceil(r / GLIMPSE)
	for _, side in { 1, -1 } do
		for k = 1, n do
			local o = math.min(k * GLIMPSE, r) * side
			local lo = (k - 1) * GLIMPSE
			while math.abs(o) > lo and not walkable(bx + ux * o, bz + uz * o, 0.04, doors, true) do
				o -= 0.1 * side
			end
			if math.abs(o) <= lo then
				break
			end
			if clear(ax, az, bx + ux * o, bz + uz * o, 0.04, doors, true) then
				return true
			end
		end
	end
	return false
end

-- Which room a point is in (0-based), or -1. A doorway counts as the room on its `a` side.
local function roomAt(x: number, z: number): number
	for i, room in ROOMS3 do
		for _, r in room.rects do
			if x >= r[1] and x <= r[3] and z >= r[2] and z <= r[4] then
				return i - 1
			end
		end
	end
	for _, d in DOORWAYS do
		local x0, z0, x1, z1 = d.rect[1], d.rect[2], d.rect[3], d.rect[4]
		if x >= x0 - 0.5 and x <= x1 + 0.5 and z >= z0 - 0.5 and z <= z1 + 0.5 then
			return d.a
		end
	end
	return -1
end
Map.roomAt = roomAt

function Map.roomCentre(i: number): Point
	local r = ROOMS3[i + 1].rects[1]
	return { x = (r[1] + r[3]) / 2, z = (r[2] + r[4]) / 2 }
end

--[[ walls, for building the world ]]

-- Cut the pieces [a, b] out of the interval [lo, hi].
local function cut(lo: number, hi: number, holes: { { number } }): { { number } }
	local out = { { lo, hi } }
	for _, hole in holes do
		local a, b = hole[1], hole[2]
		local nextOut = {}
		for _, seg in out do
			local l, h = seg[1], seg[2]
			if b <= l or a >= h then
				table.insert(nextOut, { l, h })
			else
				for _, piece in { { l, math.min(h, a) }, { math.max(l, b), h } } do
					if piece[2] - piece[1] > 0.01 then
						table.insert(nextOut, piece)
					end
				end
			end
		end
		out = nextOut
	end
	return out
end

export type Wall = {
	x0: number,
	z0: number,
	x1: number,
	z1: number,
	nx: number,
	nz: number,
	y0: number,
	h: number,
	room: number,
}

-- Every stretch of wall, as seen from inside its room. Doorways leave holes; above each hole is a lintel.
function Map.walls(): { Wall }
	local out: { Wall } = {}
	for ri0, room in ROOMS3 do
		local ri = ri0 - 1
		for k, rect in room.rects do
			local x0, z0, x1, z1 = rect[1], rect[2], rect[3], rect[4]
			local others = {}
			for j, o in room.rects do
				if j ~= k then
					table.insert(others, o)
				end
			end
			for _, side4 in
				{
					{ true, z0, x0, x1, 1 },
					{ true, z1, x0, x1, -1 },
					{ false, x0, z0, z1, 1 },
					{ false, x1, z0, z1, -1 },
				}
			do
				local horiz, side, lo, hi, n = side4[1], side4[2], side4[3], side4[4], side4[5]
				-- The doorways in this edge, and the stretch of the edge each one opens, at the same index.
				local doors = {}
				local doorSpans = {}
				for _, d in DOORWAYS do
					if d.a == ri or d.b == ri then
						local ok
						if horiz then
							ok = d.axis == "z" and (d.rect[2] == side or d.rect[4] == side)
						else
							ok = d.axis == "x" and (d.rect[1] == side or d.rect[3] == side)
						end
						local span = if horiz then { d.rect[1], d.rect[3] } else { d.rect[2], d.rect[4] }
						if ok and span[2] > lo and span[1] < hi then
							table.insert(doors, d)
							table.insert(doorSpans, span)
						end
					end
				end
				local open = {}
				for _, o in others do
					local a0, b0, a1, b1 = o[1], o[2], o[3], o[4]
					if horiz then
						if side > b0 and side < b1 then
							table.insert(open, { a0, a1 })
						end
					elseif side > a0 and side < a1 then
						table.insert(open, { b0, b1 })
					end
				end
				local function seg(a: number, b: number, y0: number, h: number)
					if horiz then
						table.insert(
							out,
							{ x0 = a, z0 = side, x1 = b, z1 = side, nx = 0, nz = n, y0 = y0, h = h, room = ri }
						)
					else
						table.insert(
							out,
							{ x0 = side, z0 = a, x1 = side, z1 = b, nx = n, nz = 0, y0 = y0, h = h, room = ri }
						)
					end
				end
				local holes = table.clone(doorSpans)
				for _, o in open do
					table.insert(holes, o)
				end
				for _, piece in cut(lo, hi, holes) do
					seg(piece[1], piece[2], 0, room.h)
				end
				for i, d in doors do
					local span = doorSpans[i]
					local dh = d.h or Data.DOOR_H
					if room.h > dh then
						seg(span[1], span[2], dh, room.h - dh)
					end
				end
			end
		end
	end
	return out
end

export type Slab = { x0: number, z0: number, x1: number, z1: number, h: number, room: number, door: any? }

-- Floor and ceiling pieces that do not overlap. Doorways come last with room -1 and their lintel height.
function Map.slabs(): { Slab }
	local out: { Slab } = {}
	for ri0, room in ROOMS3 do
		local done = {}
		for _, rect in room.rects do
			local pieces = { rect }
			for _, dn in done do
				local a0, b0, a1, b1 = dn[1], dn[2], dn[3], dn[4]
				local nextPieces = {}
				for _, p in pieces do
					local x0, z0, x1, z1 = p[1], p[2], p[3], p[4]
					if a1 <= x0 or a0 >= x1 or b1 <= z0 or b0 >= z1 then
						table.insert(nextPieces, { x0, z0, x1, z1 })
					else
						local cx0, cx1 = math.max(x0, a0), math.min(x1, a1)
						for _, q in
							{
								{ x0, z0, cx0, z1 },
								{ cx1, z0, x1, z1 },
								{ cx0, z0, cx1, math.max(z0, b0) },
								{ cx0, math.min(z1, b1), cx1, z1 },
							}
						do
							if q[3] - q[1] > 0.01 and q[4] - q[2] > 0.01 then
								table.insert(nextPieces, q)
							end
						end
					end
				end
				pieces = nextPieces
			end
			table.insert(done, rect)
			for _, p in pieces do
				table.insert(out, { x0 = p[1], z0 = p[2], x1 = p[3], z1 = p[4], h = room.h, room = ri0 - 1 })
			end
		end
	end
	for _, d in DOORWAYS do
		table.insert(out, {
			x0 = d.rect[1],
			z0 = d.rect[2],
			x1 = d.rect[3],
			z1 = d.rect[4],
			h = d.h or Data.DOOR_H,
			room = -1,
			door = d,
		})
	end
	return out
end

--[[ finding a way ]]

type Node = { x: number, z: number, room: number, door: any? }
type Link = { to: number, d: number, key: string?, duct: boolean? }
type Nav = { nodes: { Node }, links: { { Link } } }

-- Node and link indices here are 1-based, internal to this module.
local NAV: Nav? = nil
local function buildNav(): Nav
	local nodes: { Node } = {}
	local gap = MASCOT_R + 0.2
	local function add(x: number, z: number, room: number)
		if room >= 0 and walkable(x, z, MASCOT_R) then
			table.insert(nodes, { x = x, z = z, room = room })
		end
	end
	for ri, room in ROOMS3 do
		for _, r in room.rects do
			add((r[1] + r[3]) / 2, (r[2] + r[4]) / 2, ri - 1)
		end
	end
	for _, e in Data.EXTRA_NODES do
		add(e[2], e[3], e[1])
	end
	for _, o in OBSTACLES do
		local x0, z0, x1, z1 = o[1], o[2], o[3], o[4]
		for _, c in { { x0 - gap, z0 - gap }, { x1 + gap, z0 - gap }, { x0 - gap, z1 + gap }, { x1 + gap, z1 + gap } } do
			add(c[1], c[2], roomAt(c[1], c[2]))
		end
	end
	local links: { { Link } } = {}
	for i = 1, #nodes do
		links[i] = {}
	end
	local function join(i: number, j: number, key: string?, duct: boolean?)
		local d = hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z)
		table.insert(links[i], { to = j, d = d, key = key, duct = duct })
		table.insert(links[j], { to = i, d = d, key = key, duct = duct })
	end
	local sameRoom = #nodes
	for _, d in DOORWAYS do
		local x0, z0, x1, z1 = d.rect[1], d.rect[2], d.rect[3], d.rect[4]
		local cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
		local first = #nodes + 1
		local function at(lo: number, sign: number): number
			for _, outBy in { 1.5, 1, 2.2, 0.75 } do
				local v = lo + sign * outBy
				local ok = if d.axis == "x" then clear(v, cz, cx, cz, MASCOT_R) else clear(cx, v, cx, cz, MASCOT_R)
				if ok then
					return v
				end
			end
			return lo + sign * 1.5
		end
		local lowIsA = false
		for _, r in ROOMS3[d.a + 1].rects do
			if d.axis == "x" then
				if r[3] <= x0 + 0.01 and r[2] <= cz and r[4] >= cz then
					lowIsA = true
				end
			elseif r[4] <= z0 + 0.01 and r[1] <= cx and r[3] >= cx then
				lowIsA = true
			end
		end
		local lowRoom = if lowIsA then d.a else d.b
		local highRoom = if lowIsA then d.b else d.a
		if d.axis == "x" then
			table.insert(nodes, { x = at(x0, -1), z = cz, room = lowRoom, door = d })
			table.insert(nodes, { x = at(x1, 1), z = cz, room = highRoom, door = d })
		else
			table.insert(nodes, { x = cx, z = at(z0, -1), room = lowRoom, door = d })
			table.insert(nodes, { x = cx, z = at(z1, 1), room = highRoom, door = d })
		end
		table.insert(links, {})
		table.insert(links, {})
		join(first, first + 1, d.key, d.a == DUCTS or d.b == DUCTS)
	end
	for i = 1, #nodes do
		for j = i + 1, #nodes do
			if
				nodes[i].room == nodes[j].room
				and not (i > sameRoom and j > sameRoom and nodes[i].door == nodes[j].door)
			then
				if clear(nodes[i].x, nodes[i].z, nodes[j].x, nodes[j].z, MASCOT_R) then
					join(i, j, nil, nodes[i].room == DUCTS)
				end
			end
		end
	end
	return { nodes = nodes, links = links }
end

local function nav(): Nav
	if not NAV then
		NAV = buildNav()
	end
	return NAV :: Nav
end
Map.nav = nav

resetNav = function()
	NAV = nil
	buckets = nil
end
Map.resetNav = resetNav

-- The nearest waypoint a walker of radius r can reach in a straight line: one of the dozen nearest, or failing that
-- the nearest. ducts: false leaves out the waypoints inside the ducts. Nil when there is no waypoint it may use at all.
local function nearestNode(x: number, z: number, doors: Doors?, ducts: boolean?, r: number): number?
	local nodes = nav().nodes
	local tried = {}
	for _ = 1, 12 do
		local best, bd = -1, 1e9
		for i, n in nodes do
			local d = hypot(n.x - x, n.z - z)
			if d < bd and (ducts or n.room ~= DUCTS) and not table.find(tried, i) then
				bd = d
				best = i
			end
		end
		if best < 0 then
			break
		end
		if clear(x, z, nodes[best].x, nodes[best].z, r, doors) then
			return best
		end
		table.insert(tried, best)
	end
	return tried[1]
end

export type RouteOpts = { doors: Doors?, ducts: boolean?, r: number? }
export type Route = { path: { Point }, blocked: string? }

-- A route from one point to another as a list of points to walk to, ending at the goal. Returns { path, blocked }
-- where blocked is the key of the shut door the route stops in front of, when there is no open way. An empty path
-- with nothing blocked means there is no way at all.
function Map.route(ax: number, az: number, bx: number, bz: number, opts: RouteOpts?): Route
	local o: RouteOpts = opts or {}
	local nv = nav()
	local nodes, links = nv.nodes, nv.links
	local r = o.r or MASCOT_R
	if clear(ax, az, bx, bz, r, o.doors) then
		return { path = { { x = bx, z = bz } } }
	end
	local from = nearestNode(ax, az, o.doors, o.ducts, r)
	local goal = nearestNode(bx, bz, o.doors, o.ducts, r)
	if from == nil or goal == nil then
		return { path = {} }
	end
	local function search(respectDoors: boolean): { ids: { number }, via: { [number]: Link } }?
		local n = #nodes
		local dist, prev, via, done =
			table.create(n, 1e9), table.create(n, -1), {} :: { [number]: Link }, table.create(n, false)
		dist[from] = 0
		while true do
			local u, ud = -1, 1e9
			for i = 1, n do
				if not done[i] and dist[i] < ud then
					ud = dist[i]
					u = i
				end
			end
			if u < 0 or u == goal then
				break
			end
			done[u] = true
			for _, l in links[u] do
				if not (l.duct and not o.ducts) and not (respectDoors and l.key and o.doors and o.doors[l.key]) then
					if ud + l.d < dist[l.to] then
						dist[l.to] = ud + l.d
						prev[l.to] = u
						via[l.to] = l
					end
				end
			end
		end
		if dist[goal] >= 1e9 then
			return nil
		end
		local ids = {}
		local i = goal
		while i >= 1 do
			table.insert(ids, 1, i)
			i = prev[i]
		end
		return { ids = ids, via = via }
	end
	-- Skip the first waypoints if a later one is already in a straight clear line. Without this on a blocked route,
	-- a mascot just past a waypoint on its way to a shut door is sent back to it, then on again at the next ask, and
	-- paces there instead of reaching the door.
	local function skipPassed(path)
		while #path > 1 and clear(ax, az, path[2].x, path[2].z, r, o.doors) do
			table.remove(path, 1)
		end
		return path
	end
	local found = search(true)
	if not found then
		local f = search(false)
		if not f then
			return { path = {} }
		end
		-- Stop at the near side of the first shut door on the way.
		local stop = -1
		for k, id in f.ids do
			local v = f.via[id]
			if k > 1 and v and v.key and o.doors and o.doors[v.key] then
				stop = k
				break
			end
		end
		local blocked = f.via[f.ids[stop]].key
		local path = {}
		for k = 1, stop - 1 do
			local nd = nodes[f.ids[k]]
			table.insert(path, { x = nd.x, z = nd.z })
		end
		return { path = skipPassed(path), blocked = blocked }
	end
	local path = {}
	for _, id in found.ids do
		table.insert(path, { x = nodes[id].x, z = nodes[id].z })
	end
	table.insert(path, { x = bx, z = bz })
	return { path = skipPassed(path) }
end

return Map
