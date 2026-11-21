--!nonstrict
-- The night, ported from packages/sim/src/sim.ts. The server owns one Sim and steps it; clients get S. Read the JS
-- file for why each number is what it is: the comments there are the tuning record, and this port keeps the same
-- numbers and the same order of random draws so tools/roblox/diff/run.sh checks it tick by tick against the original.
--
-- Index-valued fields in S (m.i, flatBy, killer, a fault's box, p.hid, S.bats) stay 0-based, as on the web.
-- S.faults holds false where the JS holds null.

local Data = if script then require(script.Parent.Data) else (require :: any)("./Data")
local Map = if script then require(script.Parent.Map) else (require :: any)("./Map")
local Util = if script then require(script.Parent.Util) else (require :: any)("./Util")

local MASC, FINAL_NIGHT, DOORS = Data.MASC, Data.FINAL_NIGHT, Data.DOORS
local BOXES, GENERATOR, CHARGER, PANELS, BATTERY_SPOTS, HIDES, REST =
	Map.BOXES, Map.GENERATOR, Map.CHARGER, Map.PANELS, Map.BATTERY_SPOTS, Map.HIDES, Map.REST
local BOOTH, DUCTS, MASCOT_R, PLAYER_R, DOORWAYS, ROOMS3 =
	Map.BOOTH, Map.DUCTS, Map.MASCOT_R, Map.PLAYER_R, Map.DOORWAYS, Map.ROOMS3
local walkable, slide, clear, sees, reaches, roomAt, roomCentre, route, spawnPoint =
	Map.walkable, Map.slide, Map.clear, Map.sees, Map.reaches, Map.roomAt, Map.roomCentre, Map.route, Map.spawnPoint

local hypot, angDiff, dist = Util.hypot, Util.angDiff, Util.dist
local filter, some, find, count, includes = Util.filter, Util.some, Util.find, Util.count, Util.includes

local F = {
	HOUR = 70,
	WALK = 3,
	SPRINT = 5.2,
	BAT_LIFE = 65,
	PHONE = 4,
	PHONE_WALK = 0.6,
	BAT_PICKUP = 0.5,
	CHARGE = 1 / 15,
	REACH = 2.2,
	PEEL_HOLD = 3,
	HIDE_HOLD = 0.5,
	FIX = { 1.8, 2.4, 2.2 },
	BEAM_RANGE = 12,
	BEAM_HALF = 0.3,
	CATCH = 1.25,
	GRAB = 2.6,
	CALL_GAP = 3,
	RESTART = 14,
}
local DRAIN = { base = 0.02, lights = 0.03, door = 0.18, charge = 0.48 }
local WEAR = 0.07
local CRANK, BANG_COST = 0.7, 2.5
local FAULT = {
	every = 50,
	crew = 0.75,
	first = 18,
	leak = { 0.01, 0.06 },
	ripen = 50,
	scar = 65,
	cap = 0.2,
	dark = 25,
	bang = 0.35,
	outLeak = 3,
	pile = 0.4,
}
local CAP_SCALE = 25
local BANG_BOX = { L = 5, R = 7, V = 6 }
local SPEED = {
	roam = 1.5,
	search = 2.3,
	hunt = { 2.7, 2.4, 3.6, 2.6 },
	unwatched = 4.2,
	ducts = 1.4,
	charge = 7,
	dark = 1.15,
	out = 2,
}
local KEEN = { 0.8, 0.04 }
local LIT_SPEED = { 0, 0.2, 0.4 }
local ROT = { night = 0.12, hour = 0.066, ire = 0.25 }
local BANG_IRE, GLARE_PER_IRE = 0.1, 18
local FLAT_BAT = 0.5
local FEAST = 3.5
local GRAB_TIME = 1.2
local STARE = 5
local CHARGE_GAP = 10
local WINDUP = { time = 1.5, commit = 0.5 }
local SEARCH_MAX = 14
local NOTICE = 0.7
local WIND = { 8, 0.75 }
local RELENT = 8
local NEAREST = 3
local STIR, CALM = { 28, 42 }, { 24, 38 }
local SPENT = { 18, 30 }
local RAMP = { 0, 1, 2, 3.15, 4.3 }
local SNIFF = { near = 1.6, time = 3 }
local CHECK = { near = 8, chance = 0.5, most = 2 }
local LOCKER_NOISE = { 6, 0.5 }
-- Mini Biggs, the plush that sings on the torch's battery: see TOY in sim.ts.
local TOY = {
	cost = 0.2,
	range = 14,
	speed = 11,
	hear = 12,
	chance = 0.9,
	sing = 3,
}
local DREAD_SPAN, DREAD_FULL = 45, 7
local COMING = { "hunt", "windup", "charge" }
-- When each mascot first comes out, by MASC index: hours of the run, and how many sooner for each extra guard.
local WAKE = { { 0, 2 }, { 0, 2 }, { 3, 2 }, { 10, 0.8 } }

local function OPEN()
	return { L = false, V = false, R = false }
end
local function hidden(p)
	return p.hid >= 0
end
local function hideAt(i: number)
	return HIDES[i + 1]
end

--[[ questions about a state, shared with the client ]]

local Sim = {}
Sim.__index = Sim
Sim.F = F

function Sim.hourF(S): number
	return math.min(6, math.floor(S.t / F.HOUR))
end
function Sim.clockF(S): string
	local h = Sim.hourF(S)
	return tostring(if h == 0 then 12 else h) .. " AM"
end
function Sim.lightsF(S): boolean
	return not S.out
end
function Sim.dreadF(S): number
	if S.dev and S.dev.dread and S.dev.dread >= 0 then
		return S.dev.dread
	end
	return math.min(1, (S.t / DREAD_SPAN + (S.night - 1) * 2) / DREAD_FULL)
end
local function late(S): number
	if S.night <= #RAMP then
		return RAMP[S.night]
	end
	return RAMP[#RAMP] + S.night - #RAMP
end
local function rot(S, m): number
	if S.dev and S.dev.rot and S.dev.rot >= 0 then
		return S.dev.rot
	end
	local r = late(S) * ROT.night + S.t / F.HOUR * ROT.hour + (m.ire or 0) * ROT.ire
	return if r < 0.34 then 0 elseif r < 0.67 then 1 else 2
end
local function heat(S): number
	if S.out then
		return 1
	end
	return math.min(
		1,
		late(S) * 0.07 + S.t / F.HOUR * 0.03 + (100 - S.cap) / CAP_SCALE * 0.06 + (#S.players - 1) ^ 2 * 0.02
	)
end
local function pack(S): number
	return if S.out then 4 else 1 + math.floor(heat(S) * 1.2 + (#S.players - 1) * 0.45)
end
local function roster(S): number
	return if S.out then 4 else 2 + math.floor(heat(S) * 3.3 + (#S.players - 1) * 0.75)
end
local function inDucts(p): boolean
	return not p.flat and roomAt(p.x, p.z) == DUCTS
end
local function isActive(S, m): boolean
	return (S.dev and S.dev.wake and true or false)
		or S.out
		or (S.night - 1) * 6 + S.t / F.HOUR + (#S.players - 1) * WAKE[m.i + 1][2] >= WAKE[m.i + 1][1]
		or (m.i == 2 and some(S.players, inDucts))
end

-- Is a room dark: lights out with the power, or a fault in it left long enough.
function Sim.darkRoom(S, room: number): boolean
	if S.out then
		return true
	end
	for i, f in S.faults do
		if f and BOXES[i].room == room and S.t - f.at > FAULT.dark then
			return true
		end
	end
	return false
end
local darkRoom = Sim.darkRoom
function Sim.faultLeft(S, f): number
	return FAULT.scar - (S.t - f.at)
end
local faultLeft = Sim.faultLeft
local function crewRate(S)
	return 1 + FAULT.crew * (math.max(1, #S.players) - 1)
end
local function crewShare(S)
	return 1 / math.max(1, #S.players)
end
local function leakOf(S, f)
	return (FAULT.leak[1] + (FAULT.leak[2] - FAULT.leak[1]) * math.min(1, (S.t - f.at) / FAULT.ripen)) * crewShare(S)
end
local function faultGap(S)
	return FAULT.every / (1 + 0.04 * late(S) + 0.03 * S.t / F.HOUR) / crewRate(S)
end

local function newTally()
	return { fixed = 0, burnt = 0, flats = {}, peels = {} }
end
local function tallyCount(S, key, n)
	for _, t in { S.tally, S.total } do
		t[key] += n
	end
end
local function record(S, key, entry)
	for _, t in { S.tally, S.total } do
		table.insert(t[key], entry)
	end
end

local function standing(S)
	return filter(S.players, function(p)
		return not p.flat
	end)
end
-- The guards a mascot could see, light, hear or walk into: standing and not in a locker.
local function outside(S)
	return filter(S.players, function(p)
		return not p.flat and not hidden(p)
	end)
end

local function placeGuard(p, i: number)
	local sp = spawnPoint(i)
	p.x, p.z, p.yaw = sp.x, sp.z, sp.yaw
	p.pitch, p.on, p.ph, p.bat, p.flat, p.flatBy, p.sp, p.act, p.safe, p.callAt, p.hid =
		0, false, false, 1, false, -1, false, "", 0, 0, -1
	p.toy = true
end

local function newBrain(timer: number)
	return {
		path = {},
		repath = 0,
		dest = nil,
		tgt = nil,
		last = nil,
		lost = 0,
		timer = timer,
		bangs = 0,
		cool = 0,
		dir = nil,
		stuck = 0,
		key = nil,
		home = false,
		spent = false,
		woke = false,
		notice = 0,
		wind = 0,
		stared = 0,
		reach = nil,
		knows = -1,
		sniff = 0,
		checks = {},
		was = nil,
		since = 0,
		noShort = nil,
		near = nil,
		nearAt = nil,
	}
end

--[[ a sim ]]

-- rng: a function returning [0, 1). The server passes Random.new():NextNumber; the test passes recorded draws.
function Sim.new(code: string, rng: (() -> number)?)
	local self = setmetatable({}, Sim)
	self.rng = rng or function()
		return math.random()
	end
	self.players = {} -- id -> the guard's record, which is also in S.players
	self.order = {} -- ids in join order
	self.brains = {}
	self.batTimers = {}
	self.crankNoise = 0
	self.nextFault = 0
	self.S = {
		phase = "lobby",
		night = 1,
		t = 0,
		power = 100,
		doors = OPEN(),
		m = {},
		players = {},
		killer = -1,
		evs = {},
		evId = 0,
		deaths = 0,
		code = code,
	}
	return self
end

function Sim:rnd(a: number, b: number): number
	return a + self.rng() * (b - a)
end
function Sim:pick<T>(list: { T }): T
	return list[math.floor(self.rng() * #list) + 1]
end

function Sim:emit(kind: string, x: any?)
	local S = self.S
	S.evId += 1
	table.insert(S.evs, { id = S.evId, type = kind, x = x })
	if #S.evs > 10 then
		table.remove(S.evs, 1)
	end
end

function Sim:guards()
	local out = {}
	for _, id in self.order do
		table.insert(out, self.players[id])
	end
	return out
end

function Sim:addPlayer(id: string, name: string?)
	if self.players[id] then
		return
	end
	self.players[id] = { id = id, name = name or "Guard" }
	table.insert(self.order, id)
end

function Sim:removePlayer(id: string)
	self.players[id] = nil
	local k = table.find(self.order, id)
	if k then
		table.remove(self.order, k)
	end
end

function Sim:startNight(n: number)
	local S = self.S
	S.phase, S.night, S.t, S.power, S.cap, S.out, S.restart, S.stir = "play", n, 0, 100, 100, false, 0, false
	S.doors, S.killer, S.crank, S.round = OPEN(), -1, false, -1
	S.m = {}
	for i = 1, #MASC do
		local r = REST[i]
		S.m[i] = { i = i - 1, x = r.x, z = r.z, yaw = r.yaw, st = "rest", rot = 0, lit = false, ire = 0 }
	end
	local quiet = if n == 1 then 34 else math.max(12, 26 - n * 3)
	S.waveAt = quiet + self:rnd(0, 6)
	self.brains = {}
	for i = 1, #MASC do
		self.brains[i] = newBrain(self:rnd(0, 8))
	end
	S.faults = table.create(#BOXES, false)
	self.nextFault = FAULT.first + (if n == 1 then 6 else 0) + self:rnd(0, 6)
	S.tally = newTally()
	S.total = S.total or newTally()
	local all = self:guards()
	for i, p in all do
		placeGuard(p, i - 1)
	end
	S.players = all
	local spots = {}
	for i = 1, #BATTERY_SPOTS do
		spots[i] = i - 1
	end
	for i = #spots, 2, -1 do
		local j = math.floor(self.rng() * i) + 1
		spots[i], spots[j] = spots[j], spots[i]
	end
	S.batN = math.min(#spots, 3 + #all)
	S.bats = table.move(spots, 1, S.batN, 1, {})
	-- The Mini Biggses thrown, newest last (see sim.ts).
	S.toys = {}
	S.toyId = 0
	self.batTimers = {}
	self.crankNoise = 0
end

function Sim:restart()
	local S = self.S
	S.deaths, S.total = 0, nil
	self:startNight(1)
end

--[[ faults and power ]]

-- A fault breaks out in a box nobody is standing at; or, from a bang, in the box by that door. Box indices 0-based.
function Sim:breakOut(at: number?)
	local S = self.S
	local i = at
	if i == nil or S.faults[i + 1] then
		local free = {}
		for j = 0, #BOXES - 1 do
			if not S.faults[j + 1] then
				table.insert(free, j)
			end
		end
		if #free == 0 then
			return
		end
		local up = standing(S)
		local far = filter(free, function(j)
			return not some(up, function(p)
				return dist(p, BOXES[j + 1]) < 4
			end)
		end)
		i = self:pick(if #far > 0 then far else free)
	end
	local box = BOXES[(i :: number) + 1]
	S.faults[(i :: number) + 1] = { k = math.floor(self.rng() * #F.FIX), at = S.t, burnt = false }
	self:emit("fault", { i = i, x = box.x, z = box.z })
end

function Sim:stepFaults(dt: number)
	local S = self.S
	self.nextFault -= dt
	if self.nextFault <= 0 then
		self:breakOut()
		self.nextFault = faultGap(S) * self:rnd(0.7, 1.3)
	end
	for _, f in S.faults do
		if f and not f.burnt and faultLeft(S, f) <= 0 then
			f.burnt = true
			tallyCount(S, "burnt", 1)
			self:emit("burn")
		end
	end
end

function Sim:drainPower(dt: number)
	local S = self.S
	local shut = count(DOORS, function(k)
		return S.doors[k]
	end)
	local function near(p, thing)
		return not p.flat and dist(p, thing) < F.REACH
	end
	local charging = if S.out
		then {}
		else filter(S.players, function(p)
			return p.act == "charge" and near(p, CHARGER) and p.bat < 1
		end)
	S.crank = some(S.players, function(p)
		return p.act == "crank" and near(p, GENERATOR)
	end)
	for _, p in charging do
		p.bat = math.min(1, p.bat + F.CHARGE * dt)
	end
	local open = count(S.faults, function(f)
		return f and true or false
	end)
	local pile = 1 + FAULT.pile * math.max(0, open - 1 - math.floor((#S.players - 1) / 2))
	local leaks = 0
	for _, f in S.faults do
		leaks += if f then leakOf(S, f) else 0
	end
	leaks *= pile
	local burning = count(S.faults, function(f)
		return f and f.burnt
	end)
	if burning > 0 then
		S.cap = math.max(0, S.cap - FAULT.cap * burning * pile * crewShare(S) * dt)
		S.power = math.min(S.power, S.cap)
	end
	if S.dev and S.dev.power then
		S.power, S.cap, S.out = 100, 100, false
	end
	if S.out then
		S.power = 0
		local net = (if S.crank then CRANK else 0) - leaks * FAULT.outLeak
		S.restart = math.max(0, S.restart + net * dt / F.RESTART)
		if S.crank and S.cap >= F.RESTART and S.restart >= 1 then
			S.out = false
			S.power = F.RESTART
			self:emit("on")
		end
	else
		local drain = (DRAIN.base + DRAIN.lights + DRAIN.door * shut + DRAIN.charge * #charging * 2 / (#S.players + 1))
				* (1 + WEAR * late(S))
			+ leaks
		if S.power > 0 then
			S.power = math.max(0, math.min(S.cap, S.power + ((if S.crank then CRANK else 0) - drain) * dt))
		end
		if S.power <= 0 then
			S.out = true
			S.restart = 0
			S.doors = OPEN()
			self:emit("out")
		end
	end
	for _, p in S.players do
		local draw = (if p.on then 1 else 0) + (if p.ph then F.PHONE else 0)
		if draw ~= 0 then
			p.bat = math.max(0, p.bat - draw * dt / F.BAT_LIFE)
			if p.bat <= 0 then
				p.on, p.ph = false, false
			end
		end
	end
end

function Sim:respawnBatteries(dt: number)
	local S = self.S
	for k, t in self.batTimers do
		self.batTimers[k] = t - dt
	end
	while #self.batTimers > 0 and self.batTimers[1] <= 0 do
		table.remove(self.batTimers, 1)
		local free = {}
		for i, spot in BATTERY_SPOTS do
			local idx = i - 1
			if not includes(S.bats, idx) and not some(S.players, function(p)
				return dist(p, spot) < 8
			end) then
				table.insert(free, idx)
			end
		end
		if #free > 0 then
			table.insert(S.bats, self:pick(free))
		else
			table.insert(self.batTimers, 5)
		end
	end
end

function Sim:turnWave()
	local S = self.S
	if S.out then
		if not S.stir then
			S.stir = true
			self:emit("stir")
		end
		S.waveAt = S.t
		return
	end
	if S.t < S.waveAt then
		return
	end
	S.stir = not S.stir
	local h = heat(S)
	S.waveAt = S.t
		+ (if S.stir then self:rnd(STIR[1], STIR[2]) * (1 + h) else self:rnd(CALM[1], CALM[2]) * (1 - 0.7 * h))
	self:emit(if S.stir then "stir" else "calm")
end

--[[ mascots ]]

local function beamOn(S, p, m): boolean
	if not p.on or p.bat <= 0 or p.flat or p.ph or p.act == "fix" or math.abs(p.pitch) > 0.7 then
		return false
	end
	local d = dist(p, m)
	if d > F.BEAM_RANGE then
		return false
	end
	local half = F.BEAM_HALF + math.atan2(0.6, math.max(d, 0.5))
	return math.abs(angDiff(math.atan2(m.x - p.x, m.z - p.z), p.yaw)) < half and sees(p.x, p.z, m.x, m.z, S.doors)
end
local function watchedBy(S, p, m): boolean
	return not p.flat
		and math.abs(angDiff(math.atan2(m.x - p.x, m.z - p.z), p.yaw)) < 0.9
		and dist(p, m) < 20
		and sees(p.x, p.z, m.x, m.z, S.doors)
end

local function canSee(S, m, p): boolean
	local d = dist(m, p)
	local range = if p.on then 17 elseif not darkRoom(S, roomAt(p.x, p.z)) then 12 else 5
	if d > range then
		return false
	end
	if d > 2.5 and math.abs(angDiff(math.atan2(p.x - m.x, p.z - m.z), m.yaw)) > 1.2 then
		return false
	end
	return sees(m.x, m.z, p.x, p.z, S.doors)
end

function Sim:noise(x: number, z: number, radius: number, chance: number)
	local S = self.S
	for i, m in S.m do
		local b = self.brains[i]
		if
			not (
				(m.st ~= "roam" and m.st ~= "search")
				or b.home
				or hypot(m.x - x, m.z - z) > radius
				or self.rng() > chance
			)
		then
			m.st = "search"
			b.last = { x = x, z = z }
			b.timer = self:rnd(3, 6)
			b.repath = 0
		end
	end
end

-- Where a thrown thing comes down: along yaw from (x, z), as far as d, but short of a wall or a shut door. It goes
-- over the furniture, not onto it.
function Sim.landing(S, x: number, z: number, yaw: number, d: number)
	local sx, sz, step = math.sin(yaw), math.cos(yaw), 0.25
	local k = 0
	while k + step <= d and walkable(x + sx * (k + step), z + sz * (k + step), 0.1, S.doors, true) do
		k += step
	end
	while k > 0 and not walkable(x + sx * k, z + sz * k, 0.1, S.doors) do
		k -= step
	end
	return { x = x + sx * k, z = z + sz * k }
end

-- A thrown Mini Biggs that has just come down sings where it lands, and whatever hears it comes to look.
function Sim:landToys()
	local S = self.S
	for _, s in S.toys do
		if not s.heard and S.t >= s.land then
			s.heard = true
			self:emit("toy", { by = s.by, x = s.x, z = s.z })
			self:noise(s.x, s.z, TOY.hear, TOY.chance)
		end
	end
end

function Sim:pickDest(m)
	local S = self.S
	local up = outside(S)
	local room = nil
	if S.out and #standing(S) > 0 then
		local p = self:pick(standing(S))
		if hidden(p) then
			local at = hideAt(p.hid).at
			return { x = at.x, z = at.z }
		end
		return { x = p.x, z = p.z }
	end
	if #up > 0 then
		if m.i == 2 and some(up, function(p)
			return roomAt(p.x, p.z) == BOOTH
		end) and self.rng() < 0.6 then
			room = BOOTH
		elseif S.crank and self.rng() < 0.5 then
			room = GENERATOR.room
		elseif self.rng() < 0.25 + 0.5 * heat(S) then
			local p = self:pick(up)
			room = roomAt(p.x, p.z)
		end
	end
	if room == nil or room < 0 or (room == DUCTS and m.i ~= 2) then
		local here = roomAt(m.x, m.z)
		local rooms = {}
		for i = 0, #ROOMS3 - 1 do
			if i ~= BOOTH and (i ~= DUCTS or m.i == 2) and i ~= here then
				table.insert(rooms, i)
			end
		end
		room = self:pick(rooms)
	end
	local rect = self:pick(ROOMS3[room + 1].rects)
	local x0, z0, x1, z1 = rect[1], rect[2], rect[3], rect[4]
	for _ = 1, 8 do
		local x = self:rnd(x0 + 1, x1 - 1)
		local z = self:rnd(z0 + 1, z1 - 1)
		if walkable(x, z, MASCOT_R + 0.2) then
			return { x = x, z = z }
		end
	end
	return roomCentre(room)
end

local function turn(m, to: number, rate: number)
	m.yaw += math.max(-rate, math.min(rate, angDiff(to, m.yaw)))
end

-- Walk toward a goal by the open route: 'there', 'blocked', 'nowhere', 'jammed' or 'going'.
function Sim:goTo(m, b, goal, speed: number, dt: number, eager: boolean): string
	local S = self.S
	b.repath -= dt
	if dist(m, goal) < 0.6 then
		b.path = {}
		return "there"
	end
	if b.repath <= 0 or #b.path == 0 then
		local r = route(m.x, m.z, goal.x, goal.z, { doors = S.doors, ducts = m.i == 2 })
		b.path = r.path
		b.key = r.blocked
		b.repath = if eager then 0.35 else 1.5
		if #r.path == 0 and not r.blocked then
			return "nowhere"
		end
		if
			eager
			and #r.path > 1
			and not r.blocked
			and dist(m, goal) < 4
			and not (b.noShort and b.noShort > S.t)
			and clear(m.x, m.z, goal.x, goal.z, PLAYER_R, S.doors)
		then
			b.path = { goal }
		end
	end
	local function onward()
		return clear(m.x, m.z, b.path[2].x, b.path[2].z, if #b.path == 2 then PLAYER_R else MASCOT_R, S.doors)
	end
	while #b.path > 0 and dist(m, b.path[1]) < 0.6 and (#b.path == 1 or dist(m, b.path[1]) < 0.1 or onward()) do
		table.remove(b.path, 1)
	end
	local nxt = b.path[1]
	if not nxt then
		return if b.key then "blocked" else "there"
	end
	local dx, dz = nxt.x - m.x, nxt.z - m.z
	local d = hypot(dx, dz)
	local stepLen = math.min(d, speed * dt)
	turn(m, math.atan2(dx, dz), 7 * dt)
	if
		stepLen > 0
		and (slide(m, dx / d * stepLen, dz / d * stepLen, MASCOT_R, S.doors) < 0.3 or d - dist(m, nxt) < stepLen * 0.3)
	then
		b.stuck += dt
		if b.stuck > 0.8 then
			b.stuck = 0
			b.repath = 0
			if #b.path == 1 then
				b.noShort = S.t + 3
			end
			b.path = {}
			return "jammed"
		end
	else
		b.stuck = 0
	end
	return "going"
end

function Sim:endNight(by: number)
	local S = self.S
	S.phase = "dead"
	S.killer = by
	S.deaths += 1
	self:emit("scare")
end

function Sim:flatten(p, m, b)
	local S = self.S
	if S.dev and S.dev.god then
		return
	end
	p.flat, p.on, p.ph, p.flatBy, p.act, p.hid = true, false, false, m.i, "", -1
	record(S, "flats", { p.name, m.i })
	self:emit("flat", { id = p.id, by = m.i, x = p.x, z = p.z })
	p.bat *= FLAT_BAT
	m.st = "feast"
	b.timer = FEAST
	b.tgt = nil
	b.path = {}
	b.last = { x = p.x, z = p.z }
	if #standing(S) == 0 then
		self:endNight(m.i)
	end
end

function Sim:catchGuards(m, b): boolean
	local S = self.S
	for _, p in outside(S) do
		if S.t >= p.safe and dist(m, p) < F.CATCH and reaches(m.x, m.z, p.x, p.z, S.doors) then
			self:flatten(p, m, b)
			return true
		end
	end
	return false
end

function Sim:spot(m, b, p)
	local S = self.S
	if m.st ~= "hunt" then
		self:emit("spot", { i = m.i, id = p.id, x = m.x, z = m.z })
		b.notice = NOTICE
		b.repath = 0
		b.home = false
		b.wind = (WIND[1] + WIND[2] * S.night) * (if m.i ~= 0 then 1 else 1.5)
	end
	m.st = "hunt"
	b.tgt = p.id
	b.last = { x = p.x, z = p.z }
	b.lost = 0
	b.near = nil
end

function Sim:openLockers(m, b, dt: number): boolean
	local S = self.S
	local p = find(standing(S), function(q)
		if not hidden(q) or S.t < q.safe then
			return false
		end
		local at = hideAt(q.hid).at
		return dist(m, at) < SNIFF.near and reaches(m.x, m.z, at.x, at.z, S.doors)
	end)
	if not p then
		b.sniff = math.max(0, b.sniff - dt)
		return false
	end
	local h = hideAt(p.hid)
	turn(m, math.atan2(h.x - m.x, h.z - m.z), 4 * dt)
	if b.knows ~= p.hid then
		b.sniff += dt
		if b.sniff < SNIFF.time then
			return false
		end
	end
	self:emit("found", { i = m.i, id = p.id, h = p.hid, x = h.x, z = h.z })
	b.knows = -1
	b.sniff = 0
	self:flatten(p, m, b)
	return true
end

-- The lockers a mascot looks in after losing a guard near here. Hide indices 0-based.
function Sim:lockersNear(at)
	if not at then
		return {}
	end
	local cands = {}
	for i, h in HIDES do
		local d = dist(h.at, at)
		if d < CHECK.near and self.rng() < CHECK.chance then
			table.insert(cands, { i = i - 1, d = d })
		end
	end
	-- Stable insertion sort, as JS sort is stable.
	for k = 2, #cands do
		local c = cands[k]
		local j = k - 1
		while j >= 1 and cands[j].d > c.d do
			cands[j + 1] = cands[j]
			j -= 1
		end
		cands[j + 1] = c
	end
	local out = {}
	for k = 1, math.min(CHECK.most, #cands) do
		out[k] = cands[k].i
	end
	return out
end

function Sim:seenHiding(p)
	local S = self.S
	for i, m in S.m do
		local b = self.brains[i]
		if not (m.st == "rest" or (b.spent and not S.out) or not b.woke) then
			local after = includes(COMING, m.st) and b.tgt == p.id and b.lost < (if m.i == 0 then RELENT else 1.2)
			if after or canSee(S, m, p) then
				b.knows = p.hid
				if m.st == "roam" or m.st == "search" then
					m.st = "search"
					local at = hideAt(p.hid).at
					b.last = { x = at.x, z = at.z }
					b.timer = self:rnd(3, 6)
					b.repath = 0
					b.since = S.t
					b.was = "search"
				end
			end
		end
	end
end

function Sim:runMascot(m, b, dt: number)
	local S = self.S
	if not b.woke then
		b.woke = isActive(S, m)
	end
	if not b.woke then
		return
	end
	m.rot = rot(S, m)
	local up = outside(S)
	if b.knows >= 0 and not some(S.players, function(p)
		return p.hid == b.knows
	end) then
		b.knows = -1
	end
	local lighter = if m.st == "rest"
		then nil
		else find(up, function(p)
			return beamOn(S, p, m)
		end)
	m.lit = lighter ~= nil
	if lighter then
		m.ire += dt / GLARE_PER_IRE
	end
	b.cool -= dt
	if m.st ~= b.was then
		if m.st == "search" and b.was == "hunt" then
			b.checks = self:lockersNear(b.last)
		elseif m.st ~= "search" then
			b.checks = {}
		end
		b.was = m.st
		b.since = S.t
	end
	local ductGuest = if m.i == 2
		then find(up, function(p)
			return inDucts(p) and S.t >= p.safe
		end)
		else nil

	if m.st == "rest" then
		b.timer -= dt
		if ductGuest then
			self:spot(m, b, ductGuest)
		elseif b.timer <= 0 and S.stir and count(S.m, function(o)
			return o.st ~= "rest"
		end) < roster(S) then
			m.st = "roam"
			b.dest = nil
			b.home = false
		end
		return
	end
	if m.st == "feast" or m.st == "stun" then
		b.timer -= dt
		if b.timer > 0 then
			return
		end
		if m.st == "feast" then
			m.st = "search"
			b.timer = self:rnd(4, 7)
			b.repath = 0
		else
			m.st = "roam"
			b.dest = nil
			b.home = false
		end
		b.path = {}
		return
	end
	if m.st == "windup" then
		local tp = find(S.players, function(p)
			return p.id == b.tgt
		end)
		if tp and b.timer > WINDUP.commit then
			turn(m, math.atan2(tp.x - m.x, tp.z - m.z), 5 * dt)
		end
		b.timer -= dt
		if b.timer <= 0 then
			m.st = "charge"
			b.timer = 2.4
			b.dir = { x = math.sin(m.yaw), z = math.cos(m.yaw) }
		end
		return
	end
	if m.st == "charge" then
		local got = slide(m, b.dir.x * SPEED.charge * dt, b.dir.z * SPEED.charge * dt, MASCOT_R, S.doors)
		if self:catchGuards(m, b) then
			return
		end
		b.timer -= dt
		if got < 0.5 then
			m.st = "stun"
			b.timer = 4
			b.cool = CHARGE_GAP
			self:emit("crash", { x = m.x, z = m.z })
		elseif b.timer <= 0 then
			m.st = "hunt"
			b.cool = CHARGE_GAP
		end
		return
	end

	local seen, near = nil, 1e9
	local looking = not b.spent or S.out
	if looking then
		for _, p in up do
			if S.t >= p.safe and canSee(S, m, p) and dist(m, p) < near then
				near = dist(m, p)
				seen = p
			end
		end
	end
	if not seen and looking and lighter and S.t >= lighter.safe then
		seen = lighter
	end
	local stare = false
	if seen and (m.st == "hunt" or count(S.m, function(o)
		return includes(COMING, o.st)
	end) < pack(S)) then
		near = dist(m, seen)
		self:spot(m, b, seen)
	elseif ductGuest and looking then
		seen = ductGuest
		near = dist(m, seen)
		self:spot(m, b, seen)
	elseif seen then
		b.stared += dt
		if b.stared < STARE then
			turn(m, math.atan2(seen.x - m.x, seen.z - m.z), 3 * dt)
			stare = true
		end
		seen = nil
	else
		b.stared = math.max(0, b.stared - dt * 2)
	end

	if m.st == "siege" then
		local door = find(DOORWAYS, function(d)
			return d.key == b.key
		end)
		if door then
			turn(
				m,
				math.atan2((door.rect[1] + door.rect[3]) / 2 - m.x, (door.rect[2] + door.rect[4]) / 2 - m.z),
				5 * dt
			)
		end
		if self:catchGuards(m, b) then
			return
		end
		if not S.doors[b.key] then
			m.st = if b.tgt then "hunt" else "roam"
			b.repath = 0
			return
		end
		b.timer -= dt
		if b.timer > 0 then
			return
		end
		self:emit("bang", b.key)
		m.ire += BANG_IRE
		b.bangs += 1
		if self.rng() < FAULT.bang then
			self:breakOut(BANG_BOX[b.key])
		end
		if not (S.dev and S.dev.power) then
			S.power = math.max(0, S.power - BANG_COST)
		end
		b.timer = self:rnd(1.6, 3)
		if b.bangs >= 3 + (if S.night > 2 then 1 else 0) then
			m.st = "roam"
			b.tgt = nil
			b.dest = nil
			b.path = {}
			b.bangs = 0
			b.timer = 0
			b.spent = true
		end
		return
	end

	local check = if m.st == "search" and #b.checks > 0 then hideAt(b.checks[1]) else nil
	if check and dist(m, check.at) < SNIFF.near then
		local i = table.remove(b.checks, 1)
		if some(S.players, function(p)
			return p.hid == i and not p.flat
		end) then
			b.knows = i
		else
			self:emit("check", { i = m.i, h = i, x = check.x, z = check.z })
			b.timer = math.max(b.timer, 1.5)
		end
	end
	if looking and self:openLockers(m, b, dt) then
		return
	end

	local quit = false
	if m.st == "hunt" and not S.out and b.notice <= 0 then
		b.wind -= dt
		quit = b.wind <= 0
	end
	if quit then
		m.st = "roam"
		b.tgt = nil
		b.dest = nil
		b.spent = true
		self:emit("quit", { i = m.i, x = m.x, z = m.z })
	elseif not seen and m.st == "hunt" then
		local tp = find(S.players, function(p)
			return p.id == b.tgt
		end)
		local keeps = if m.i == 0 then RELENT else 1.2
		b.lost += dt
		if tp and hidden(tp) and b.knows == tp.hid then
			local at = hideAt(tp.hid).at
			b.last = { x = at.x, z = at.z }
			b.lost = 0
		elseif tp and not tp.flat and not hidden(tp) and b.lost < keeps then
			b.last = { x = tp.x, z = tp.z }
			b.near = nil
		end
		local d = dist(m, b.last)
		if b.near == nil or d < b.near - 0.3 then
			b.near = d
			b.nearAt = S.t
		end
		if not tp or tp.flat or S.t - (b.nearAt or S.t) > NEAREST then
			m.st = "search"
			b.timer = self:rnd(4, 7)
		end
	elseif not seen then
		local loud = not b.home and find(up, function(p)
			return p.sp and dist(m, p) < 9
		end)
		if loud then
			m.st = "search"
			b.last = { x = loud.x, z = loud.z }
			b.timer = self:rnd(3, 6)
		end
	end

	local angry = (KEEN[1] + KEEN[2] * late(S))
		* (1 + 0.04 * math.min(4, (100 - S.cap) / CAP_SCALE))
		* (if darkRoom(S, roomAt(m.x, m.z)) then SPEED.dark else 1)
	local speed, goal, eager = 0, nil, false
	if m.st == "hunt" then
		goal = b.last
		eager = true
		if b.notice > 0 then
			b.notice -= dt
			turn(m, math.atan2(goal.x - m.x, goal.z - m.z), 5 * dt)
			speed = 0
		elseif
			m.i == 3
			and seen
			and b.cool <= 0
			and near > 6
			and near < 16
			and clear(m.x, m.z, seen.x, seen.z, MASCOT_R, S.doors)
		then
			m.st = "windup"
			b.timer = WINDUP.time
			self:emit("roar", { i = m.i, x = m.x, z = m.z })
			return
		else
			speed = SPEED.hunt[m.i + 1] * angry
			if m.i == 1 and not some(up, function(p)
				return watchedBy(S, p, m)
			end) then
				speed = SPEED.unwatched * angry
			end
			if m.i == 2 and roomAt(m.x, m.z) == DUCTS then
				speed *= SPEED.ducts
			end
		end
	elseif m.st == "search" and S.t - b.since > SEARCH_MAX then
		m.st = "roam"
		b.dest = nil
		return
	elseif m.st == "search" then
		speed = SPEED.search * angry
		local check = if #b.checks > 0 then hideAt(b.checks[1]) else nil
		goal = if check then check.at else b.last
	else
		local settle = (not S.stir or b.spent) and not S.out
		if settle ~= b.home then
			b.home = settle
			b.dest = if settle then REST[m.i + 1] else nil
			b.repath = 0
		end
		if b.home and dist(m, REST[m.i + 1]) < 1.5 then
			m.st = "rest"
			b.timer = if b.spent then self:rnd(SPENT[1], SPENT[2]) * (1 - 0.5 * heat(S)) else self:rnd(0, 8)
			b.spent = false
			b.path = {}
			return
		end
		if not b.dest then
			b.dest = self:pickDest(m)
			b.repath = 0
		end
		speed = SPEED.roam
		goal = b.dest
	end
	if S.out then
		speed *= SPEED.out
	end
	if m.lit then
		speed *= LIT_SPEED[m.rot + 1]
	end
	if stare then
		speed = 0
	end
	if m.lit and lighter then
		turn(m, math.atan2(lighter.x - m.x, lighter.z - m.z), 4 * dt)
	end

	local res = if speed > 0 then self:goTo(m, b, goal, speed, dt, eager) else "going"
	if self:catchGuards(m, b) then
		return
	end
	local tucked = m.st == "hunt"
		and speed > 0
		and seen ~= nil
		and near < F.GRAB
		and reaches(m.x, m.z, seen.x, seen.z, S.doors)
	local r = b.reach
	if not tucked or not r or r.id ~= seen.id or near < r.d - 0.3 or dist(seen, r) > 0.5 then
		b.reach = if tucked then { id = seen.id, d = near, x = seen.x, z = seen.z, t = S.t } else nil
	elseif S.t - r.t > GRAB_TIME then
		self:flatten(seen, m, b)
		return
	end
	if res == "blocked" then
		m.st = "siege"
		b.timer = 1.2
		b.bangs = 0
		self:emit("arrive", b.key)
		return
	end
	if res == "nowhere" then
		m.st = "roam"
		b.tgt = nil
		b.dest = if b.home then REST[m.i + 1] else nil
		return
	end
	if res == "jammed" and not seen then
		if m.st == "hunt" then
			m.st = "search"
			b.timer = self:rnd(3, 5)
			b.last = { x = m.x, z = m.z }
		elseif m.st == "search" and #b.checks > 0 then
			table.remove(b.checks, 1)
		elseif m.st == "search" then
			m.st = "roam"
			b.dest = nil
		elseif not b.home then
			b.dest = nil
		end
		return
	end
	if res == "there" then
		if m.st == "roam" then
			b.timer -= dt
			if b.timer <= 0 then
				b.dest = nil
				b.timer = self:rnd(2, 7)
			end
		elseif m.st == "search" then
			m.yaw += dt * 1.5
			b.timer -= dt
			if b.timer <= 0 then
				m.st = "roam"
				b.dest = nil
				b.timer = self:rnd(1, 3)
			end
		elseif m.st == "hunt" and not seen then
			m.st = "search"
			b.timer = self:rnd(3, 5)
		end
	end
end

--[[ the tick ]]

-- dt is real seconds since the last step, capped at a quarter second as stepFloor caps it.
function Sim:step(dt: number)
	local S = self.S
	dt = math.min(0.25, dt) * (S.dev and S.dev.speed or 1)
	S.players = self:guards()
	if S.phase ~= "play" then
		return
	end
	for i, p in S.players do
		if p.x == nil then
			placeGuard(p, i - 1)
		end
	end
	if #S.players > 0 and #standing(S) == 0 then
		self:endNight(S.players[1].flatBy)
		return
	end
	S.t += dt
	local hour = math.floor(S.t / F.HOUR)
	if hour > S.round then
		if S.round >= 0 then
			self:emit("hour")
		end
		S.round = hour
		if hour >= 6 then
			S.phase = if S.night >= FINAL_NIGHT then "won" else "win"
			self:emit("win")
			return
		end
	end
	self:stepFaults(dt)
	self:drainPower(dt)
	self:respawnBatteries(dt)
	self:turnWave()
	if S.crank then
		self.crankNoise -= dt
		if self.crankNoise <= 0 then
			self.crankNoise = 2
			self:noise(GENERATOR.x, GENERATOR.z, 24, 0.35)
		end
	end
	self:landToys()
	if S.dev and S.dev.freeze then
		return
	end
	for i = 1, #S.m do
		if S.phase ~= "play" then
			break
		end
		self:runMascot(S.m[i], self.brains[i], dt)
	end
end

local function num(v: any, lo: number, hi: number, fallback: number): number
	return if Util.isFinite(v) then math.max(lo, math.min(hi, v)) else fallback
end

-- One guard's action. a.t: 'p' (where they are and what they hold), 'call', 'throw', or 'use' with a.what. There is
-- no 'name': the server takes names from Roblox.
function Sim:act(pid: string, a: any)
	local S = self.S
	local p = self.players[pid]
	if not p or type(a) ~= "table" then
		return
	end
	if S.phase ~= "play" or p.x == nil then
		return
	end
	if a.t == "p" then
		if hidden(p) then
			p.yaw = num(a.yaw, -1e3, 1e3, p.yaw)
			p.pitch = num(a.pitch, -1.6, 1.6, p.pitch)
			p.on, p.sp, p.act = false, false, ""
			p.ph = not not a.ph and p.bat > 0
			return
		end
		if not p.flat and Util.isFinite(a.x) and Util.isFinite(a.z) and walkable(a.x, a.z, 0.2, S.doors) then
			p.x = a.x
			p.z = a.z
		end
		p.yaw = num(a.yaw, -1e3, 1e3, p.yaw)
		p.pitch = num(a.pitch, -1.6, 1.6, p.pitch)
		p.on = not not a.on and p.bat > 0 and not p.flat
		p.ph = not not a.ph and p.bat > 0 and not p.flat
		p.sp = not not a.sp and not p.flat and not p.ph
		p.act = if p.flat then "" elseif a.act == "crank" or a.act == "charge" or a.act == "fix" then a.act else ""
		return
	end
	if a.t == "call" then
		if p.flat and S.t >= (p.callAt or 0) then
			p.callAt = S.t + F.CALL_GAP
			self:emit("call", { id = p.id, x = p.x, z = p.z })
		end
		return
	end
	if a.t == "throw" then
		-- Their Mini Biggs, along the way the guard is looking (yaw) and as far as they aimed (d), sung on the torch's
		-- battery. Not from a locker, and not on less than it costs.
		if p.flat or hidden(p) or not p.toy or p.bat < TOY.cost then
			return
		end
		local to = Sim.landing(S, p.x, p.z, num(a.yaw, -1e3, 1e3, p.yaw), num(a.d, 0, TOY.range, TOY.range))
		p.bat = math.max(0, p.bat - TOY.cost)
		p.toy = false
		if p.bat <= 0 then
			p.on, p.ph = false, false
		end
		S.toyId += 1
		table.insert(S.toys, {
			id = S.toyId,
			by = p.id,
			x0 = p.x,
			z0 = p.z,
			x = to.x,
			z = to.z,
			at = S.t,
			land = S.t + math.max(0.3, dist(p, to) / TOY.speed),
			heard = false,
		})
		return
	end
	if a.t ~= "use" or p.flat then
		return
	end
	local function near(thing)
		return thing ~= nil and dist(p, thing) < F.REACH
	end
	local i = if type(a.i) == "number" then a.i else -1
	if a.what == "fix" and S.faults[i + 1] and near(BOXES[i + 1]) then
		S.faults[i + 1] = false
		tallyCount(S, "fixed", 1)
		self:emit("fix", { i = i, by = p.id, x = BOXES[i + 1].x, z = BOXES[i + 1].z })
		self:noise(p.x, p.z, 16, 0.5)
	elseif a.what == "door" and includes(DOORS, a.k) and Sim.lightsF(S) and near(PANELS[a.k]) then
		local d = find(DOORWAYS, function(dw)
			return dw.key == a.k
		end)
		local x0, z0, x1, z1 = d.rect[1], d.rect[2], d.rect[3], d.rect[4]
		local function inWay(q, r)
			return q.x > x0 - r and q.x < x1 + r and q.z > z0 - r and q.z < z1 + r
		end
		if
			not S.doors[a.k]
			and (
				some(S.players, function(q)
					return inWay(q, PLAYER_R)
				end) or some(S.m, function(m)
					return inWay(m, MASCOT_R)
				end)
			)
		then
			self:emit("fumble", { k = a.k, by = p.id })
			return
		end
		S.doors[a.k] = not S.doors[a.k]
		self:emit("door", S.doors[a.k])
	elseif a.what == "bat" and includes(S.bats, i) and near(BATTERY_SPOTS[i + 1]) and p.bat < 1 then
		S.bats = filter(S.bats, function(j)
			return j ~= i
		end)
		table.insert(self.batTimers, self:rnd(30, 50))
		p.bat = math.min(1, p.bat + F.BAT_PICKUP)
		self:emit("bat", { by = p.id })
	elseif a.what == "toy" and not p.toy and not hidden(p) then
		-- A Mini Biggs on the floor, anyone's, into empty hands. Not one still in the air.
		local k = nil
		for j, o in S.toys do
			if o.id == a.id then
				k = j
			end
		end
		local t = k and S.toys[k]
		if not t or S.t < t.land or not near(t) then
			return
		end
		table.remove(S.toys, k)
		p.toy = true
		self:emit("grab", { by = p.id, x = t.x, z = t.z })
	elseif a.what == "hide" and HIDES[i + 1] then
		local h = HIDES[i + 1]
		if p.hid == i then
			p.hid = -1
			self:emit("locker", { i = i, id = p.id, ["in"] = false, x = h.x, z = h.z })
			self:noise(h.at.x, h.at.z, LOCKER_NOISE[1], LOCKER_NOISE[2])
		elseif not hidden(p) and near(h.at) and not some(S.players, function(q)
			return q.hid == i
		end) then
			p.hid, p.x, p.z, p.on, p.sp, p.act = i, h.at.x, h.at.z, false, false, ""
			self:emit("locker", { i = i, id = p.id, ["in"] = true, x = h.x, z = h.z })
			self:seenHiding(p)
			self:noise(h.at.x, h.at.z, LOCKER_NOISE[1], LOCKER_NOISE[2])
		end
	elseif a.what == "peel" then
		local other = find(S.players, function(q)
			return q.id == a.id
		end)
		if other and other.flat and near(other) then
			other.flat, other.flatBy, other.safe = false, -1, S.t + 4
			record(S, "peels", p.name)
			self:emit("peel", { id = other.id, by = p.id, x = other.x, z = other.z })
		end
	end
end

return Sim
