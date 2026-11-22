--!nonstrict
-- The mascots and the other guards, drawn from S and eased between the server's ten updates a second.
--
-- Stand-ins: the web game's mascots are rigid-part models (packages/game/public/models/<k>_<rot>.glb, built by tools/models)
-- posed by name: body, neck, head, jaw, limbs. Until those are uploaded as Roblox meshes each mascot is a few
-- blocks with the same joints, sized and coloured after its model, so the poses here carry over.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Data = require(Shared.Data)
local Make = require(Shared.Make)
local Map = require(Shared.Map)
local Units = require(Shared.Units)
local Util = require(Shared.Util)

local SC = Units.SC
local part = Make.part
local STAGE = Data.STAGE

-- By MASC index: body [width, height, depth], head size, colour, and what sticks out of the face.
local LOOK = {
	{ body = { 2.0, 1.7, 1.6 }, head = 1.15, legs = 0.55, col = "#9a7fc4", snout = { 0.9, 0.5, 0.45 } }, -- Big Biggs, hippo
	{ body = { 1.6, 1.9, 1.3 }, head = 0.95, legs = 0.5, col = "#b98a6e", snout = { 0.6, 0.35, 0.35 }, tusks = true }, -- Madame Flan, walrus
	{ body = { 1.7, 1.0, 1.5 }, head = 1.0, legs = 0.35, col = "#5f8f66", snout = { 0.9, 0.25, 0.3 } }, -- Squish, toad
	{ body = { 1.5, 1.5, 2.2 }, head = 0.9, legs = 0.6, col = "#7d8299", snout = { 0.45, 0.4, 0.5 }, horn = true }, -- Stompy, rhino
}
-- SpotLight brightness of a teammate's torch: dimmer than your own, as TORCH_POWER in actors.ts is.
local MATE_TORCH = 2.5
local EYES = { Color3.fromRGB(240, 240, 230), Color3.fromRGB(255, 210, 60), Color3.fromRGB(255, 40, 30) } -- by rot

local function floorY(x: number, z: number): number
	return if Map.roomAt(x, z) == STAGE.room and z < STAGE.edge then STAGE.rise else 0
end

local function darken(c: Color3, k: number): Color3
	return Color3.new(c.R * k, c.G * k, c.B * k)
end

local function buildMascot(i: number, folder)
	local look = LOOK[i]
	local col = Color3.fromHex(look.col)
	local model = Instance.new("Model")
	model.Name = Data.MASC[i].name
	model.Parent = folder
	local w, h, d = look.body[1], look.body[2], look.body[3]
	local parts = {}
	parts.body =
		part({ Size = Units.size(w, h, d), Color = col, Material = Enum.Material.Fabric, CastShadow = true }, model)
	parts.head = part({
		Size = Units.size(look.head, look.head, look.head),
		Color = col,
		Material = Enum.Material.Fabric,
		CastShadow = true,
	}, model)
	local sn = look.snout
	parts.snout = part(
		{ Size = Units.size(sn[1], sn[2], sn[3]), Color = darken(col, 0.85), Material = Enum.Material.Fabric },
		model
	)
	parts.jaw = part(
		{ Size = Units.size(sn[1] * 0.9, 0.14, sn[3] * 0.9), Color = darken(col, 0.6), Material = Enum.Material.Fabric },
		model
	)
	parts.eyes = {}
	for s = 1, 2 do
		parts.eyes[s] = part({
			Shape = Enum.PartType.Ball,
			Size = Units.size(0.16, 0.16, 0.16),
			Color = EYES[1],
			Material = Enum.Material.Neon,
		}, model)
	end
	parts.legs = {}
	for s = 1, 4 do
		parts.legs[s] = part({
			Size = Units.size(0.4, look.legs, 0.4),
			Color = darken(col, 0.8),
			Material = Enum.Material.Fabric,
			CastShadow = true,
		}, model)
	end
	if look.tusks then
		parts.tusks = {}
		for s = 1, 2 do
			parts.tusks[s] = part({ Size = Units.size(0.07, 0.4, 0.07), Color = Color3.fromRGB(240, 230, 200) }, model)
		end
	end
	if look.horn then
		parts.horn = part({ Size = Units.size(0.14, 0.45, 0.14), Color = Color3.fromRGB(200, 196, 180) }, model)
	end
	local glow = Instance.new("PointLight")
	glow.Range = 2 * SC
	glow.Brightness = 0
	glow.Color = EYES[3]
	glow.Parent = parts.head
	return {
		model = model,
		parts = parts,
		look = look,
		col = col,
		glow = glow,
		x = nil,
		z = nil,
		yaw = 0,
		gait = 0,
		speed = 0,
		jaw = 0,
	}
end

-- Pose one mascot at (x, z, yaw) for its state. Offsets are in the model's own metres: x across, y up, z forward.
local function pose(a, m, t: number)
	local look, parts = a.look, a.parts
	local w, h, d = look.body[1], look.body[2], look.body[3]
	local y0 = floorY(a.x, a.z)
	local root = CFrame.new(Units.v3(a.x, y0, a.z)) * CFrame.Angles(0, a.yaw, 0)
	local function at(x, y, z)
		return root * CFrame.new(x * SC, y * SC, z * SC)
	end
	-- Rotten ones stand taller and darker.
	local tall = 1 + 0.12 * m.rot
	local bob = math.sin(a.gait) * 0.08 * math.min(1, a.speed / 2)
	local lean, squash, shake = 0, 1, 0
	if m.st == "feast" then
		squash = 0.6
	elseif m.st == "windup" then
		lean, shake = 0.25, 0.04
	elseif m.st == "charge" then
		lean = 0.45
	elseif m.st == "stun" then
		lean = math.sin(t * 9) * 0.15
	elseif m.st == "hunt" then
		lean = 0.12
	end
	local legH = look.legs * tall
	local bodyY = legH + h * squash / 2 + bob
	local sx = math.sin(t * 60) * shake
	parts.body.Size = Units.size(w, h * squash * tall, d)
	parts.body.CFrame = at(sx, bodyY, 0) * CFrame.Angles(-lean, 0, 0)
	local hs = look.head
	local headCF = parts.body.CFrame * CFrame.new(0, (h * squash * tall / 2 + hs * 0.25) * SC, (d / 2 - hs * 0.1) * SC)
	-- The head looks up at a torch.
	headCF *= CFrame.Angles(if m.lit then -0.25 else 0, 0, 0)
	parts.head.CFrame = headCF
	local sn = look.snout
	parts.snout.CFrame = headCF * CFrame.new(0, -hs * 0.1 * SC, (hs / 2 + sn[3] / 2 - 0.05) * SC)
	parts.jaw.CFrame = headCF
		* CFrame.new(0, (-hs * 0.1 - sn[2] / 2) * SC, (hs / 2) * SC)
		* CFrame.Angles(a.jaw, 0, 0)
		* CFrame.new(0, 0, sn[3] * 0.45 * SC)
	for s, e in parts.eyes do
		local side = if s == 1 then -1 else 1
		e.CFrame = headCF * CFrame.new(side * hs * 0.28 * SC, hs * 0.2 * SC, hs * 0.5 * SC)
		e.Color = EYES[m.rot + 1]
	end
	for s, leg in parts.legs do
		local side = if s % 2 == 1 then -1 else 1
		local fore = if s <= 2 then 1 else -1
		local swing = math.sin(a.gait + (if s == 1 or s == 4 then 0 else math.pi)) * 0.35 * math.min(1, a.speed / 2)
		leg.Size = Units.size(0.4, legH, 0.4)
		leg.CFrame = at(side * w * 0.3, legH, fore * d * 0.3)
			* CFrame.Angles(swing, 0, 0)
			* CFrame.new(0, -legH / 2 * SC, 0)
	end
	if parts.tusks then
		for s, tk in parts.tusks do
			local side = if s == 1 then -1 else 1
			tk.CFrame = parts.snout.CFrame * CFrame.new(side * sn[1] * 0.3 * SC, -sn[2] * 0.6 * SC, sn[3] * 0.3 * SC)
		end
	end
	if parts.horn then
		parts.horn.CFrame = parts.snout.CFrame
			* CFrame.new(0, sn[2] * 0.7 * SC, sn[3] * 0.2 * SC)
			* CFrame.Angles(-0.3, 0, 0)
	end
	local fade = 1 - 0.18 * m.rot
	for _, p in { parts.body, parts.head } do
		p.Color = darken(a.col, fade)
	end
	a.glow.Brightness = if m.rot == 2 then 0.8 else 0
end

local function buildGuard(folder, name: string)
	local model = Instance.new("Model")
	model.Name = name
	model.Parent = folder
	local body =
		part({ Size = Units.size(0.5, 1.2, 0.35), Color = Color3.fromHex("#2a3550"), CastShadow = true }, model)
	local head = part({
		Shape = Enum.PartType.Ball,
		Size = Units.size(0.3, 0.3, 0.3),
		Color = Color3.fromHex("#d2b48c"),
		CastShadow = true,
	}, model)
	local cap = part({ Size = Units.size(0.32, 0.08, 0.36), Color = Color3.fromHex("#1a2238") }, model)
	local holder, torch = Make.torch(model)
	local tag = Instance.new("BillboardGui")
	tag.Size = UDim2.fromOffset(160, 24)
	tag.StudsOffset = Vector3.new(0, 0.5 * SC, 0)
	tag.AlwaysOnTop = false
	tag.LightInfluence = 0
	tag.Adornee = head
	tag.Parent = head
	local text = Instance.new("TextLabel")
	text.BackgroundTransparency = 1
	text.Size = UDim2.fromScale(1, 1)
	text.Font = Enum.Font.GothamBold
	text.TextSize = 14
	text.TextColor3 = Color3.fromHex("#a6e3a1")
	text.Text = name
	text.Parent = tag
	return {
		model = model,
		body = body,
		head = head,
		cap = cap,
		holder = holder,
		torch = torch,
		x = nil,
		z = nil,
		yaw = 0,
		pitch = 0,
	}
end

local Actors = {}

function Actors.new()
	local folder = Instance.new("Folder")
	folder.Name = "Actors"
	folder.Parent = workspace
	local mascots = {}
	for i = 1, #Data.MASC do
		mascots[i] = buildMascot(i, folder)
	end
	local guards = {}
	local self = {}

	-- Ease toward where the server says, turning the short way round.
	local function ease(a, x, z, yaw, k)
		if not a.x then
			a.x, a.z, a.yaw = x, z, yaw
			return 0
		end
		local nx, nz = a.x + (x - a.x) * k, a.z + (z - a.z) * k
		local moved = Util.hypot(nx - a.x, nz - a.z)
		a.x, a.z = nx, nz
		a.yaw += Util.angDiff(yaw, a.yaw) * k
		return moved
	end

	-- myId: this client's guard, drawn by the camera rather than a body.
	function self.sync(S, dt: number, t: number, myId: string)
		local k = math.min(1, dt * 10)
		for i, a in mascots do
			local m = S.m[i]
			a.model.Parent = if m then folder else nil
			if m then
				-- A night began: jump, do not glide across the building.
				if a.x and Util.hypot(m.x - a.x, m.z - a.z) > 6 then
					a.x = nil
				end
				local moved = ease(a, m.x, m.z, m.yaw, k)
				a.speed += ((if dt > 0 then moved / dt else 0) - a.speed) * math.min(1, dt * 6)
				a.gait += dt * a.speed * 3.2
				local wantJaw = if m.st == "hunt"
						or m.st == "charge"
						or m.st == "windup"
					then 0.5
					elseif m.st == "feast" then 0.8
					else 0
				a.jaw += (wantJaw - a.jaw) * math.min(1, dt * 6)
				pose(a, m, t)
			end
		end
		local seen = {}
		for _, p in S.players do
			if p.id ~= myId and p.x then
				seen[p.id] = true
				local g = guards[p.id]
				if not g then
					g = buildGuard(folder, p.name)
					guards[p.id] = g
				end
				ease(g, p.x, p.z, p.yaw, k)
				g.pitch += (p.pitch - g.pitch) * k
				local y0 = floorY(g.x, g.z)
				local hidden = p.hid >= 0
				for _, part_ in { g.body, g.head, g.cap } do
					part_.Transparency = if hidden then 1 else 0
				end
				if p.flat then
					-- Flat on the floor, face up.
					local root = CFrame.new(Units.v3(g.x, y0 + 0.12, g.z))
						* CFrame.Angles(0, g.yaw + math.pi, 0)
						* CFrame.Angles(math.pi / 2, 0, 0)
					g.body.CFrame = root
					g.head.CFrame = root * CFrame.new(0, 0.75 * SC, 0)
					g.cap.CFrame = g.head.CFrame * CFrame.new(0, 0.12 * SC, 0)
				else
					local root = Units.cf(g.x, y0, g.z, g.yaw)
					g.body.CFrame = root
						* CFrame.new(0, 0.6 * SC + (if p.sp then math.sin(t * 13) * 0.04 * SC else 0), 0)
					g.head.CFrame = root * CFrame.new(0, 1.5 * SC, 0) * CFrame.Angles(g.pitch, 0, 0)
					g.cap.CFrame = g.head.CFrame * CFrame.new(0, 0.14 * SC, -0.02 * SC)
				end
				g.holder.CFrame = Units.eye(g.x, 1.4, g.z, g.yaw, g.pitch) * CFrame.new(0.22 * SC, 0, -0.3 * SC)
				g.torch.Brightness = if p.on and not p.flat and p.bat > 0 then MATE_TORCH else 0
			end
		end
		for id, g in guards do
			if not seen[id] then
				g.model:Destroy()
				guards[id] = nil
			end
		end
	end

	-- Where a teammate's eyes are, for a flat guard watching them.
	function self.eyeOf(id: string)
		local g = guards[id]
		if not g or not g.x then
			return nil
		end
		return Units.eye(g.x, Map.EYE, g.z, g.yaw, g.pitch)
	end

	-- The mascot's head, for the catch.
	function self.headOf(i: number)
		local a = mascots[i + 1]
		return a and a.parts.head.CFrame
	end
	return self
end

return Actors
