--!nonstrict
-- The Depot, built on this client from the same data the sim walks (Shared/Map, Shared/Data): walls, floors and
-- ceilings, the furniture as stand-in blocks, the things a guard uses, the booth's doors, the lamps and the wall
-- map. Nothing here is replicated; every client builds its own, as every browser does on the web.
--
-- Stand-ins: the web game swaps blocks for its Blender models (packages/game/public/models) when they load. Here the blocks are
-- what there is until those models are uploaded as Roblox assets.

local Lighting = game:GetService("Lighting")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Data = require(Shared.Data)
local Map = require(Shared.Map)
local Sim = require(Shared.Sim)
local Units = require(Shared.Units)

local v3, size, SC = Units.v3, Units.size, Units.SC
local ROOMS3, DOORWAYS, BOXES, PANELS = Map.ROOMS3, Map.DOORWAYS, Map.BOXES, Map.PANELS
local GENERATOR, CHARGER, WALL_MAP, BATTERY_SPOTS = Map.GENERATOR, Map.CHARGER, Map.WALL_MAP, Map.BATTERY_SPOTS
local STAGE = Data.STAGE

-- Fog: what FogExp2 .037 (and .03 more with dread) on the web looks like, as a linear fog's start and end.
local FOG = { start = 4, finish = 30, dread = 12 }

-- Per room: floor, wall and ceiling as { material, colour }. After LOOK in three/world/surfaces.js.
local M = Enum.Material
local LOOK = {
	{ { M.WoodPlanks, "#3a2a1c" }, { M.Fabric, "#4a1616" }, { M.SmoothPlastic, "#0b0b0d" } }, -- Storage Stage
	{ { M.Wood, "#4a3a2a" }, { M.Concrete, "#55595a" }, { M.Concrete, "#2e2f30" } }, -- Backstage
	{ { M.Carpet, "#1d1233" }, { M.Plaster, "#251b3b" }, { M.CeramicTiles, "#2a2a30" } }, -- Arcade
	{ { M.CeramicTiles, "#8a8678" }, { M.Plaster, "#6a4a3a" }, { M.CeramicTiles, "#5a5a58" } }, -- Main Hall
	{ { M.CeramicTiles, "#9aa0a0" }, { M.CeramicTiles, "#b8c0bc" }, { M.CeramicTiles, "#6a6e6e" } }, -- Kitchen
	{ { M.Concrete, "#4a4a48" }, { M.Plaster, "#4a5a50" }, { M.Concrete, "#333533" } }, -- West Hall
	{ { M.SmoothPlastic, "#6a5040" }, { M.Plaster, "#7a4a2a" }, { M.CeramicTiles, "#5a5048" } }, -- Snack Bar
	{ { M.Concrete, "#4a4842" }, { M.Plaster, "#5a5040" }, { M.Concrete, "#333230" } }, -- East Hall
	{ { M.DiamondPlate, "#5c6268" }, { M.DiamondPlate, "#5c6268" }, { M.DiamondPlate, "#4c5258" } }, -- Ducts
	{ { M.Carpet, "#3a3a40" }, { M.Plaster, "#5a5040" }, { M.CeramicTiles, "#6a6660" } }, -- Security Booth
}

-- Stand-in furniture: height in metres, colour, material. Props not listed are wall and ceiling dressing, left out.
local PROP = {
	generator = { 1, "#7a5c2e", M.Metal },
	desk = { 0.75, "#4a3a2a", M.Wood },
	locker = { 1.9, "#4d5a55", M.Metal },
	crate = { 1.05, "#6b5233", M.WoodPlanks },
	barrel = { 0.9, "#3b4b5a", M.Metal },
	speaker = { 1.3, "#1b1b1e", M.Plastic },
	costume_rack = { 1.7, "#5c4b6e", M.Fabric },
	spare_heads = { 1.8, "#6e5c4b", M.Wood },
	mannequin = { 1.7, "#b9a68e", M.SmoothPlastic },
	vanity = { 0.8, "#5a3a2a", M.Wood },
	trunk = { 0.7, "#3a2a1a", M.Wood },
	arcade_cabinet = { 1.8, "#2a2050", M.Plastic },
	claw_machine = { 1.9, "#a83a6a", M.Plastic },
	skee_ball = { 1.1, "#3a5a2a", M.Wood },
	prize_counter = { 1.05, "#6a2a2a", M.Wood },
	table_round = { 0.75, "#d8d2c4", M.Fabric },
	table_long = { 0.75, "#d8d2c4", M.Fabric },
	standee = { 1.9, "#d0a040", M.Cardboard },
	counter_steel = { 0.92, "#a8aeb2", M.Metal },
	fridge = { 1.9, "#c8ccc8", M.Metal },
	range = { 0.92, "#4a4a4a", M.Metal },
	sink_unit = { 0.92, "#a8aeb2", M.Metal },
	wire_shelf = { 1.8, "#8a8e90", M.Metal },
	snack_counter = { 1.05, "#c8501e", M.Wood },
	soda_machine = { 1.85, "#a01818", M.Plastic },
	popcorn_cart = { 1.6, "#c83030", M.Plastic },
}

local function hexColor(s: string): Color3
	return Color3.fromHex(s)
end

local root: Folder
local function part(props): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = M.SmoothPlastic
	for k, v in props do
		(p :: any)[k] = v
	end
	p.Parent = props.Parent or root
	return p
end

-- A box from (x0, y0, z0) to (x1, y1, z1), metres.
local function slab(x0, y0, z0, x1, y1, z1, look, parent)
	return part({
		Size = size(x1 - x0, y1 - y0, z1 - z0),
		CFrame = CFrame.new(v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)),
		Material = look[1],
		Color = hexColor(look[2]),
		Parent = parent,
	})
end

-- A frame on one of map.js's wall things: at (at.x, y, at.z), its -Z looking out of the wall.
local function mount(at, y: number): CFrame
	return Units.cf(at.x, y, at.z, at.face)
end
-- A point in a mount's own metres: x across, y up, z out of the wall.
local function local3(x: number, y: number, z: number): CFrame
	return CFrame.new(x * SC, y * SC, -z * SC)
end

local function floorY(x: number, z: number): number
	return if Map.roomAt(x, z) == STAGE.room and z < STAGE.edge then STAGE.rise else 0
end

--[[ the shell ]]

local function buildShell()
	local shell = Instance.new("Folder")
	shell.Name = "Shell"
	shell.Parent = root
	for _, s in Map.slabs() do
		if s.room >= 0 then
			local look = LOOK[s.room + 1]
			local cuts = { { s.z0, s.z1 } }
			if s.room == STAGE.room and s.z0 < STAGE.edge and s.z1 > STAGE.edge then
				cuts = { { s.z0, STAGE.edge }, { STAGE.edge, s.z1 } }
			end
			for _, c in cuts do
				local y = floorY((s.x0 + s.x1) / 2, (c[1] + c[2]) / 2)
				slab(s.x0, y - 0.3, c[1], s.x1, y, c[2], look[1], shell)
			end
			slab(s.x0, s.h, s.z0, s.x1, s.h + 0.3, s.z1, look[3], shell)
		else
			-- A doorway: floor, and a lintel's underside at the door's height.
			slab(s.x0, -0.3, s.z0, s.x1, 0, s.z1, LOOK[s.door.a + 1][1], shell)
			slab(s.x0, s.h, s.z0, s.x1, s.h + 0.3, s.z1, LOOK[s.door.a + 1][3], shell)
		end
	end
	-- Walls are a quarter metre thick, behind the room's edge: the two rooms either side of a half-metre wall meet in it.
	local T = 0.25
	for _, w in Map.walls() do
		local look = LOOK[w.room + 1][2]
		local ox, oz = -w.nx * T / 2, -w.nz * T / 2
		if w.nz ~= 0 then
			slab(w.x0, w.y0, w.z0 + oz - T / 2, w.x1, w.y0 + w.h, w.z0 + oz + T / 2, look, shell)
		else
			slab(w.x0 + ox - T / 2, w.y0, w.z0, w.x0 + ox + T / 2, w.y0 + w.h, w.z1, look, shell)
		end
	end
	-- The stage's lip.
	local rect = ROOMS3[STAGE.room + 1].rects[1]
	slab(rect[1], 0, STAGE.edge - 0.02, rect[3], STAGE.rise, STAGE.edge, { M.Wood, "#2a1a0e" }, shell)
end

--[[ furniture ]]

local function buildProps()
	local props = Instance.new("Folder")
	props.Name = "Props"
	props.Parent = root
	for _, rows in Data.DRESSING do
		for _, row in rows do
			local name, x, z, yaw, opt = row[1], row[2], row[3], row[4], row[5]
			local look, foot = PROP[name], Data.FOOT[name]
			if look and foot and not (opt and opt.soft) then
				local s = opt and opt.s or 1
				local a = math.rad(yaw)
				local ox, oz = (foot[3] or 0) * s, (foot[4] or 0) * s
				local c, sn = math.cos(a), math.sin(a)
				local cx, cz = x + ox * c + oz * sn, z + oz * c - ox * sn
				local y = floorY(x, z)
				part({
					Name = name,
					Size = size(foot[1] * s, look[1] * s, foot[2] * s),
					CFrame = CFrame.new(v3(cx, y + look[1] * s / 2, cz)) * CFrame.Angles(0, a, 0),
					Color = hexColor(look[2]),
					Material = look[3],
					CastShadow = true,
					Parent = props,
				})
			end
		end
	end
end

--[[ lamps ]]

-- A lamp group's level at time t: 'on' is steady, fa, fb and fc flicker each their own way.
local function flicker(g: string, t: number, i: number): number
	if g == "fa" then
		return if math.sin(t * 1.7 + i) * math.sin(t * 0.63 + i * 2) > 0.82 then 0.15 else 1
	elseif g == "fb" then
		return 0.82 + 0.18 * math.sin(t * 47 + i) * math.sin(t * 3.1)
	elseif g == "fc" then
		return if math.sin(t * 0.9 + i * 4) > 0.94 then 0.1 + 0.2 * math.abs(math.sin(t * 31)) else 1
	end
	return 1
end

type Lamp = { def: any, light: PointLight, glow: BasePart?, room: number, base: number, i: number }

local function buildLamps(): { Lamp }
	local folder = Instance.new("Folder")
	folder.Name = "Lamps"
	folder.Parent = root
	local lamps = {}
	for i, l in Data.LAMPS do
		local room = math.max(0, Map.roomAt(l.x, l.z))
		local h = ROOMS3[room + 1].h
		local col = Units.rgb(l.col)
		local y, at, glow
		if l.kind == "tube" then
			y = h - 0.12
			local long = l.dir == "x"
			glow = part({
				Size = if long then size(1.2, 0.06, 0.12) else size(0.12, 0.06, 1.2),
				CFrame = CFrame.new(v3(l.x, h - 0.04, l.z)),
				Material = M.Neon,
				Color = col,
				Parent = folder,
			})
			at = v3(l.x, y, l.z)
		elseif l.kind == "red" or l.kind == "exit" then
			local n = l.n
			y = l.y or 2.3
			glow = part({
				Size = if l.kind == "exit" then size(0.5, 0.2, 0.05) else size(0.18, 0.12, 0.08),
				CFrame = CFrame.lookAt(v3(l.x + n[1] * 0.04, y, l.z + n[2] * 0.04), v3(l.x + n[1], y, l.z + n[2])),
				Material = M.Neon,
				Color = col,
				Parent = folder,
			})
			at = v3(l.x + n[1] * 0.3, y, l.z + n[2] * 0.3)
		else
			y = l.y or h - 0.6
			if l.kind == "bulb" then
				glow = part({
					Shape = Enum.PartType.Ball,
					Size = size(0.12, 0.12, 0.12),
					CFrame = CFrame.new(v3(l.x, y, l.z)),
					Material = M.Neon,
					Color = col,
					Parent = folder,
				})
			end
			at = v3(l.x, y, l.z)
		end
		local holder = part({ Transparency = 1, Size = Vector3.one * 0.2, CFrame = CFrame.new(at), Parent = folder })
		local light = Instance.new("PointLight")
		light.Color = col
		light.Range = math.min(60, l.reach * SC)
		light.Shadows = l.kind ~= "glow"
		light.Parent = holder
		table.insert(lamps, { def = l, light = light, glow = glow, room = room, base = l.pow * 1.6, i = i })
	end
	for _, d in Data.DEAD_TUBES do
		local room = math.max(0, Map.roomAt(d[1], d[2]))
		local h = ROOMS3[room + 1].h
		part({
			Size = if d[3] == "x" then size(1.2, 0.06, 0.12) else size(0.12, 0.06, 1.2),
			CFrame = CFrame.new(v3(d[1], h - 0.04, d[2])),
			Color = Color3.fromRGB(40, 42, 40),
			Parent = folder,
		})
	end
	return lamps
end

--[[ the things a guard uses ]]

local AMBER, DONE, OFF = Color3.fromHex("#ffb040"), Color3.fromHex("#2c7a2c"), Color3.fromHex("#1a0d00")
local SHUT, OPEN, DEAD = Color3.fromHex("#d20f39"), Color3.fromHex("#40a02b"), Color3.fromHex("#222222")

local function buildUsables()
	local folder = Instance.new("Folder")
	folder.Name = "Usables"
	folder.Parent = root
	local u = { boxes = {}, panels = {}, bats = {}, doors = {} }

	for i, b in BOXES do
		local cf = mount(b, 1.3)
		local body = part({
			Name = "BreakerBox",
			Size = size(0.5, 0.7, 0.16),
			CFrame = cf * local3(0, 0, 0.08),
			Color = hexColor("#5a5f66"),
			Material = M.Metal,
			Parent = folder,
		})
		local lamp = part({
			Shape = Enum.PartType.Ball,
			Size = size(0.1, 0.1, 0.1),
			CFrame = cf * local3(0, 0.42, 0.1),
			Material = M.Neon,
			Color = OFF,
			Parent = folder,
		})
		local hinge = cf * local3(-0.25, 0, 0.17)
		local door = part({
			Size = size(0.48, 0.68, 0.03),
			CFrame = hinge * local3(0.24, 0, 0),
			Color = hexColor("#6b7078"),
			Material = M.Metal,
			Parent = folder,
		})
		local sparks = Instance.new("ParticleEmitter")
		sparks.Color = ColorSequence.new(Color3.fromHex("#ff7a20"))
		sparks.LightEmission = 1
		sparks.Size = NumberSequence.new(0.15, 0)
		sparks.Lifetime = NumberRange.new(0.15, 0.35)
		sparks.Speed = NumberRange.new(4, 9)
		sparks.SpreadAngle = Vector2.new(60, 60)
		sparks.Rate = 0
		sparks.Parent = body
		local glow = Instance.new("PointLight")
		glow.Color = Color3.fromHex("#ff7a20")
		glow.Range = 9 * SC
		glow.Brightness = 0
		glow.Shadows = true
		glow.Parent = body
		u.boxes[i] = { body = body, lamp = lamp, door = door, hinge = hinge, open = 0, sparks = sparks, glow = glow }
	end

	for _, k in Data.DOORS do
		local cf = mount(PANELS[k], 1.3)
		part({
			Name = "DoorButton",
			Size = size(0.25, 0.4, 0.1),
			CFrame = cf * local3(0, 0, 0.05),
			Color = hexColor("#3b3f4a"),
			Parent = folder,
		})
		local lamp = part({
			Shape = Enum.PartType.Cylinder,
			Size = size(0.05, 0.12, 0.12),
			CFrame = cf * local3(0, 0, 0.12) * CFrame.Angles(0, math.pi / 2, 0),
			Material = M.Neon,
			Color = OPEN,
			Parent = folder,
		})
		u.panels[k] = { lamp = lamp }
	end

	-- GENERATOR is where a guard stands to crank; the machine is behind that point.
	local gcf = mount(GENERATOR, floorY(GENERATOR.x, GENERATOR.z))
	part({
		Name = "Generator",
		Size = size(1.4, 1, 0.8),
		CFrame = gcf * local3(0, 0.5, -Data.GEN_BACK),
		Color = hexColor("#7a5c2e"),
		Material = M.Metal,
		CastShadow = true,
		Parent = folder,
	})
	u.crankHub = gcf * local3(0, 0.7, 0.45 - Data.GEN_BACK)
	u.crank = part({
		Size = size(0.08, 0.5, 0.08),
		CFrame = u.crankHub,
		Color = hexColor("#c8c8c8"),
		Material = M.Metal,
		Parent = folder,
	})

	local dcf = mount(CHARGER, 1.2)
	part({
		Name = "Charger",
		Size = size(0.6, 0.4, 0.15),
		CFrame = dcf * local3(0, 0, 0.08),
		Color = hexColor("#2f4f6f"),
		Parent = folder,
	})
	u.dockLamp = part({
		Size = size(0.3, 0.05, 0.02),
		CFrame = dcf * local3(0, 0.12, 0.16),
		Material = M.Neon,
		Color = OPEN,
		Parent = folder,
	})

	for i, s in BATTERY_SPOTS do
		local base = floorY(s.x, s.z) + 0.2
		local p = part({
			Size = size(0.12, 0.16, 0.12),
			CFrame = CFrame.new(v3(s.x, base, s.z)),
			Material = M.Neon,
			Color = hexColor("#f9e2af"),
			Transparency = 1,
			Parent = folder,
		})
		local l = Instance.new("PointLight")
		l.Color = hexColor("#f9e2af")
		l.Range = 2.5 * SC
		l.Brightness = 0
		l.Parent = p
		u.bats[i] = { part = p, light = l, x = s.x, z = s.z, base = base }
	end

	-- The booth's doors: shutters that drop from above the doorway.
	for _, d in DOORWAYS do
		if d.key then
			local x0, z0, x1, z1 = d.rect[1], d.rect[2], d.rect[3], d.rect[4]
			local h = d.h or Data.DOOR_H
			local sz = if d.axis == "x" then size(0.16, h, z1 - z0) else size(x1 - x0, h, 0.16)
			local p = part({
				Name = "BoothDoor",
				Size = sz,
				Color = hexColor("#565a66"),
				Material = M.DiamondPlate,
				CastShadow = true,
				Parent = folder,
			})
			u.doors[d.key] = { part = p, h = h, at = 0, x = (x0 + x1) / 2, z = (z0 + z1) / 2 }
		end
	end
	return u
end

--[[ the wall map ]]

local MAP_K, MAP_OX, MAP_OY = 8.2, 14, 9

local function buildWallMap()
	local cf = mount(WALL_MAP, 1.6) * local3(0, 0, 0.03)
	local screen = part({
		Name = "WallMap",
		Size = size(1.64, 0.76, 0.04),
		CFrame = cf,
		Color = hexColor("#070b08"),
		Parent = root,
	})
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.CanvasSize = Vector2.new(820, 380)
	gui.LightInfluence = 0
	gui.Brightness = 1.5
	gui.Parent = screen
	local plan = Instance.new("Frame")
	plan.BackgroundColor3 = hexColor("#070b08")
	plan.Size = UDim2.fromScale(1, 1)
	plan.BorderSizePixel = 0
	plan.Parent = gui
	local function rect(x, y, w, h, color, parent)
		local f = Instance.new("Frame")
		f.Position = UDim2.fromOffset(x, y)
		f.Size = UDim2.fromOffset(w, h)
		f.BackgroundColor3 = color
		f.BorderSizePixel = 0
		f.Parent = parent or plan
		return f
	end
	local px = function(x)
		return MAP_OX + x * MAP_K
	end
	local py = function(z)
		return MAP_OY + z * MAP_K
	end
	for _, room in ROOMS3 do
		for _, r in room.rects do
			local f = rect(px(r[1]), py(r[2]), (r[3] - r[1]) * MAP_K, (r[4] - r[2]) * MAP_K, hexColor("#12261a"))
			local stroke = Instance.new("UIStroke")
			stroke.Color = hexColor("#3d7a4c")
			stroke.Thickness = 2
			stroke.Parent = f
		end
	end
	local doorRects = {}
	for _, d in DOORWAYS do
		if d.key then
			doorRects[d.key] = rect(
				px(d.rect[1]) - 1,
				py(d.rect[2]) - 1,
				(d.rect[3] - d.rect[1]) * MAP_K + 2,
				(d.rect[4] - d.rect[2]) * MAP_K + 2,
				hexColor("#12261a")
			)
		end
	end
	local boxDots = {}
	for i, b in BOXES do
		boxDots[i] = rect(px(b.x) - 4, py(b.z) - 4, 8, 8, hexColor("#3d7a4c"))
		local c = Instance.new("UICorner")
		c.CornerRadius = UDim.new(1, 0)
		c.Parent = boxDots[i]
	end
	local dots = Instance.new("Folder")
	dots.Parent = plan
	local legend = Instance.new("TextLabel")
	legend.BackgroundTransparency = 1
	legend.Position = UDim2.fromOffset(400, 20)
	legend.Size = UDim2.fromOffset(400, 340)
	legend.Font = Enum.Font.Code
	legend.TextSize = 20
	legend.TextXAlignment = Enum.TextXAlignment.Left
	legend.TextYAlignment = Enum.TextYAlignment.Top
	legend.TextColor3 = hexColor("#7fbf8a")
	legend.Parent = plan
	local blank = rect(0, 0, 820, 380, hexColor("#070b08"))
	blank.ZIndex = 5

	local nextAt = 0
	return function(S, t)
		if t < nextAt then
			return
		end
		nextAt = t + 0.5
		blank.Visible = not Sim.lightsF(S)
		if blank.Visible then
			return
		end
		for k, f in doorRects do
			f.BackgroundColor3 = if S.doors[k] then hexColor("#c0392b") else hexColor("#12261a")
		end
		for i, dot in boxDots do
			local f = S.faults and S.faults[i]
			local r = if f then 7 else 4
			dot.Size = UDim2.fromOffset(r * 2, r * 2)
			dot.Position = UDim2.fromOffset(px(BOXES[i].x) - r, py(BOXES[i].z) - r)
			dot.BackgroundColor3 = if f
				then (if t % 1 < 0.5 then hexColor("#f38ba8") else hexColor("#f9e2af"))
				else hexColor("#3d7a4c")
		end
		dots:ClearAllChildren()
		for _, m in S.m do
			if m.st ~= "rest" then
				local f = rect(px(m.x) - 8, py(m.z) - 8, 16, 16, hexColor(Data.MASC[m.i + 1].col), dots)
				local c = Instance.new("UICorner")
				c.CornerRadius = UDim.new(1, 0)
				c.Parent = f
			end
		end
		for _, p in S.players do
			if p.x then
				rect(px(p.x) - 4, py(p.z) - 4, 8, 8, if p.flat then hexColor("#6c7086") else hexColor("#a6e3a1"), dots)
			end
		end
		local out, due = 0, {}
		for _, m in S.m do
			if m.st ~= "rest" then
				out += 1
			end
		end
		for i, b in BOXES do
			if S.faults and S.faults[i] then
				table.insert(due, "  " .. ROOMS3[b.room + 1].name)
			end
		end
		legend.Text = string.format(
			"MASCOT DEPOT\n\nPOWER    %d%%\nOFF MARK %d of %d\n\n%s\n%s",
			math.ceil(S.power),
			out,
			#S.m,
			if #due > 0 then "FAULTS" else "NO FAULTS",
			table.concat(due, "\n", 1, math.min(#due, 7))
		)
	end
end

--[[ the world ]]

local World = {}

function World.build()
	local existing = workspace:FindFirstChild("Depot")
	if existing then
		existing:Destroy()
	end
	root = Instance.new("Folder")
	root.Name = "Depot"
	root.Parent = workspace
	buildShell()
	buildProps()
	local lamps = buildLamps()
	local u = buildUsables()
	local updateMap = buildWallMap()

	Lighting.FogColor = Color3.fromRGB(3, 3, 5)
	local cc = Instance.new("ColorCorrectionEffect")
	cc.Name = "Dread"
	cc.Parent = Lighting

	local self = {}
	-- dread, fear: 0 to 1 (Sim.dreadF and the client's threat). camPos: the camera, for the nearest fault lights.
	function self.update(S, t: number, dt: number, camPos: Vector3, dread: number, fear: number)
		updateMap(S, t)
		Lighting.FogStart = FOG.start * SC
		Lighting.FogEnd = (FOG.finish - FOG.dread * dread) * SC
		cc.Saturation = -0.55 * dread
		cc.Contrast = 0.1 * dread + 0.15 * fear
		cc.TintColor = Color3.new(1, 1 - 0.25 * fear, 1 - 0.3 * fear)

		-- The lamps give less every night and with the dread, and stutter when the power is nearly gone.
		local night = (S.night or 1) - 1
		local level = (1 - 0.06 * night) * (1 - 0.35 * dread)
		local low = S.power < 10 and S.power > 0 and math.sin(t * 23) * math.sin(t * 7) > 0.3
		for _, l in lamps do
			local g = l.def.g
			local on
			if l.def.kind == "exit" then
				on = 1
			elseif l.def.kind == "glow" then
				on = if Sim.lightsF(S) and not Sim.darkRoom(S, l.room) then 1 else 0
			else
				on = if Sim.lightsF(S) and not Sim.darkRoom(S, l.room) then flicker(g, t, l.i) else 0
				if low then
					on *= 0.2
				end
			end
			l.light.Brightness = l.base * level * on
			if l.glow then
				l.glow.Transparency = if on > 0.3 then 0 else 0.85
			end
		end

		-- Breaker boxes: the lamp, the door hanging open, sparks and the light of a short.
		local pulse = 0.6 + 0.4 * math.sin(t * 6)
		local open = {}
		for i, b in u.boxes do
			local f = S.faults and S.faults[i]
			b.lamp.Color = if f
				then (if pulse > 0.6 then Color3.fromRGB(255, 32, 32) else AMBER)
				elseif S.power > 0 then DONE
				else OFF
			b.open += ((if f then 1 else 0) - b.open) * math.min(1, dt * 8)
			b.door.CFrame = b.hinge * CFrame.Angles(0, -1.6 * b.open, 0) * local3(0.24, 0, 0)
			b.sparks.Rate = if f then 18 else 0
			if f then
				table.insert(open, { i = i, d = (b.body.CFrame.Position - camPos).Magnitude })
			else
				b.glow.Brightness = 0
			end
		end
		table.sort(open, function(a, b)
			return a.d < b.d
		end)
		for k, o in open do
			local crackle = (if math.sin(t * 37 + o.i * 9.1) * math.sin(t * 23.7 + o.i * 3.3) > 0.2 then 1 else 0.15)
			u.boxes[o.i].glow.Brightness = if k <= 3 then 2.2 * crackle else 0
		end

		for _, k in Data.DOORS do
			local shut = S.doors and S.doors[k]
			u.panels[k].lamp.Color = if S.power <= 0 then DEAD elseif shut then SHUT else OPEN
			local d = u.doors[k]
			d.at += ((if shut then 1 else 0) - d.at) * math.min(1, dt * 12)
			d.part.CFrame = CFrame.new(v3(d.x, d.h * (1 - d.at) + d.h / 2, d.z))
			d.part.Transparency = if d.at > 0.01 then 0 else 1
		end
		u.dockLamp.Color = if S.power > 0 then OPEN else DEAD

		local bats = {}
		for _, i in S.bats or {} do
			bats[i + 1] = true
		end
		for i, b in u.bats do
			local here = bats[i] == true
			b.part.Transparency = if here then 0 else 1
			b.light.Brightness = if here then 0.6 + 0.3 * math.sin(t * 3) else 0
			b.part.CFrame = CFrame.new(v3(b.x, b.base + math.sin(t * 2 + i) * 0.04, b.z)) * CFrame.Angles(0, t * 1.5, 0)
		end
		if S.crank then
			u.crank.CFrame = u.crankHub * CFrame.Angles(0, 0, t * 7)
		end
	end
	return self
end

return World
