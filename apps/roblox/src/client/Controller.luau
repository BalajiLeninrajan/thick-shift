--!nonstrict
-- This guard: walking, looking, the torch and using things. Ported from packages/game/src/three/player.js. The client
-- owns its own position and tells the server about twelve times a second (a 'p' action); everything else about
-- the guard comes back in S. Keyboard and mouse only so far: the web game's gamepad and touch controls are not
-- ported yet.

local UserInputService = game:GetService("UserInputService")
local ContextActionService = game:GetService("ContextActionService")
local GuiService = game:GetService("GuiService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Map = require(Shared.Map)
local Sim = require(Shared.Sim)
local Text = require(Shared.Text)
local Units = require(Shared.Units)
local Util = require(Shared.Util)

local F = Sim.F
local PLAYER_R, EYE = Map.PLAYER_R, Map.EYE
local BOXES, GENERATOR, CHARGER, PANELS, BATTERY_SPOTS, HIDES =
	Map.BOXES, Map.GENERATOR, Map.CHARGER, Map.PANELS, Map.BATTERY_SPOTS, Map.HIDES

local SENS = 0.0022 -- radians per pixel of mouse travel
local SEND = 0.08
local PITCH_MAX = 1.45
local STAMINA = { drain = 1 / 4.5, gain = 1 / 7, rest = 1 }
local LOCKER_LOOK = { yaw = 0.85, pitch = 0.5, eye = 0.34 }
local TORCH_FULL = 3 -- SpotLight brightness on a full battery

local Controller = {}

-- send: fires an action at the server. fixPanel: the minigame panel (Task.luau).
function Controller.new(myId: string, send: (any) -> (), fixPanel)
	local me = {
		x = 0,
		z = 0,
		yaw = math.pi,
		pitch = 0,
		on = false,
		stam = 1,
		sp = false,
		act = "",
		bob = 0,
		target = nil,
		hold = 0,
		moving = 0,
		flat = false,
		watch = nil,
		ph = false,
		task = nil,
		hid = -1,
		placed = false,
	}
	local keys: { [Enum.KeyCode]: boolean } = {}
	local sinceSprint, lastSend, usedTap, lastCall, drop = 0, 0, false, -1e9, 0
	local S = nil

	-- The torch: a SpotLight on an invisible part that rides with the camera.
	local holder = Instance.new("Part")
	holder.Name = "Torch"
	holder.Anchored, holder.CanCollide, holder.CanQuery, holder.CanTouch = true, false, false, false
	holder.Transparency = 1
	holder.Size = Vector3.one * 0.2
	holder.Parent = workspace
	local torch = Instance.new("SpotLight")
	torch.Color = Color3.fromRGB(255, 240, 208)
	torch.Angle = 60
	torch.Range = math.min(60, 22 * Units.SC)
	torch.Shadows = true
	torch.Brightness = 0
	torch.Face = Enum.NormalId.Front
	torch.Parent = holder

	local function playing()
		return S and S.phase == "play"
	end
	local function letGo()
		if me.task then
			me.task = nil
			fixPanel.close()
		end
	end
	local function mine()
		if not S then
			return nil
		end
		for _, p in S.players do
			if p.id == myId then
				return p
			end
		end
		return nil
	end
	local function toggleTorch()
		if playing() and not me.flat and me.hid < 0 then
			me.on = not me.on
		end
	end
	local function call()
		if not playing() or not me.flat or os.clock() - lastCall < F.CALL_GAP then
			return
		end
		lastCall = os.clock()
		send({ t = "call" })
	end
	-- A flat guard steps through the standing teammates' views, then back to their own.
	local function watchNext()
		if not playing() or not me.flat then
			return
		end
		local ids = {}
		for _, p in S.players do
			if not p.flat and p.id ~= myId and p.x then
				table.insert(ids, p.id)
			end
		end
		local k = table.find(ids, me.watch)
		me.watch = ids[(k or 0) + 1]
	end

	local function look(dx: number, dy: number)
		me.yaw -= dx * SENS
		me.pitch = math.clamp(me.pitch - dy * SENS, -PITCH_MAX, PITCH_MAX)
	end

	-- Game keys go to the game, not to Roblox's own bindings.
	local GAME_KEYS = {
		Enum.KeyCode.W,
		Enum.KeyCode.A,
		Enum.KeyCode.S,
		Enum.KeyCode.D,
		Enum.KeyCode.E,
		Enum.KeyCode.F,
		Enum.KeyCode.Q,
		Enum.KeyCode.Space,
		Enum.KeyCode.LeftShift,
		Enum.KeyCode.RightShift,
	}
	ContextActionService:BindActionAtPriority("ThickShiftKeys", function(_, state, input)
		if not playing() or fixPanel.active then
			return Enum.ContextActionResult.Pass
		end
		local code = input.KeyCode
		if state == Enum.UserInputState.Begin then
			keys[code] = true
			if code == Enum.KeyCode.F then
				toggleTorch()
			elseif code == Enum.KeyCode.Q then
				call()
			elseif code == Enum.KeyCode.Space then
				watchNext()
			end
		elseif state == Enum.UserInputState.End or state == Enum.UserInputState.Cancel then
			keys[code] = nil
		end
		return Enum.ContextActionResult.Sink
	end, false, Enum.ContextActionPriority.High.Value, table.unpack(GAME_KEYS))

	UserInputService.InputChanged:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseMovement and playing() and not GuiService.MenuIsOpen then
			look(input.Delta.X, input.Delta.Y)
		end
	end)
	UserInputService.InputBegan:Connect(function(input, processed)
		if not processed and input.UserInputType == Enum.UserInputType.MouseButton1 and not fixPanel.active then
			toggleTorch()
		end
	end)
	UserInputService.WindowFocusReleased:Connect(function()
		table.clear(keys)
	end)

	-- The nearest thing in reach and roughly in front: { what, label, hold, ... }. hold: seconds to hold E, 0 for
	-- a tap, -1 for as long as it is held.
	local function findTarget(m)
		local list = {}
		for i, f in S.faults or {} do
			if f then
				table.insert(
					list,
					{ what = "fix", i = i - 1, at = BOXES[i], label = Text.FAULT_NAME[f.k + 1], hold = 0 }
				)
			end
		end
		if S.power > 0 then
			for k, at in PANELS do
				table.insert(list, {
					what = "door",
					k = k,
					at = at,
					label = (if S.doors[k] then "Open" else "Shut") .. " the " .. Text.DOOR_NAME[k],
					hold = 0,
				})
			end
		end
		if m.bat < 1 then
			for _, i in S.bats or {} do
				table.insert(
					list,
					{ what = "bat", i = i, at = BATTERY_SPOTS[i + 1], label = "Take the battery", hold = 0 }
				)
			end
		end
		for _, p in S.players do
			if p.flat and p.id ~= myId then
				table.insert(list, {
					what = "peel",
					id = p.id,
					at = p,
					label = "Peel " .. p.name .. " off the floor",
					hold = F.PEEL_HOLD,
				})
			end
		end
		table.insert(list, {
			what = "crank",
			at = GENERATOR,
			label = if S.power >= 100 then "The generator is full" else "Crank the generator",
			hold = if S.power >= 100 then 0 else -1,
		})
		if S.power > 0 and m.bat < 1 then
			table.insert(list, { what = "charge", at = CHARGER, label = "Charge the torch", hold = -1 })
		end
		if m.hid >= 0 then
			return { what = "hide", i = m.hid, at = HIDES[m.hid + 1].at, label = "Step out of the locker", hold = 0 }
		end
		for i, h in HIDES do
			local taken = false
			for _, p in S.players do
				if p.hid == i - 1 then
					taken = true
				end
			end
			if not taken then
				table.insert(
					list,
					{ what = "hide", i = i - 1, at = h.at, label = "Hide in the locker", hold = F.HIDE_HOLD }
				)
			end
		end
		local best, bd = nil, F.REACH - 0.2
		for _, t in list do
			local dx, dz = t.at.x - me.x, t.at.z - me.z
			local d = Util.hypot(dx, dz)
			if d < bd and (d < 0.9 or (dx * math.sin(me.yaw) + dz * math.cos(me.yaw)) / d > 0.45) then
				bd = d
				best = t
			end
		end
		return best
	end

	local function held()
		return keys[Enum.KeyCode.E] == true
	end

	local function use(dt: number)
		local t = me.target
		me.act = ""
		if me.task then
			-- Hands in the box until the job is done or let go. Fixed by someone else, or out of reach: let go.
			local f = S.faults and S.faults[me.task.i + 1]
			local b = BOXES[me.task.i + 1]
			if not f or f.at ~= me.task.at or Util.hypot(b.x - me.x, b.z - me.z) > F.REACH then
				letGo()
			else
				me.act = "fix"
				return
			end
		end
		if not held() then
			usedTap = false
		end
		if t and t.what == "fix" and held() and not usedTap then
			usedTap = true
			me.hold = 0
			keys[Enum.KeyCode.E] = nil -- the panel takes the key from here
			local f = S.faults[t.i + 1]
			me.task = { i = t.i, at = f.at }
			fixPanel.open(t.i, f.k, function()
				send({ t = "use", what = "fix", i = t.i })
				me.task = nil
			end, function()
				me.task = nil
			end)
			me.act = "fix"
			return
		end
		if not t or not held() then
			me.hold = 0
			return
		end
		if t.hold < 0 then
			me.act = t.what
			return
		end
		if usedTap then
			return
		end
		me.hold += dt
		if me.hold >= t.hold then
			send({ t = "use", what = t.what, i = t.i, k = t.k, id = t.id })
			me.hold = 0
			usedTap = true
		end
	end

	local function walk(dt: number)
		local f = (if keys[Enum.KeyCode.W] then 1 else 0) - (if keys[Enum.KeyCode.S] then 1 else 0)
		local s = (if keys[Enum.KeyCode.D] then 1 else 0) - (if keys[Enum.KeyCode.A] then 1 else 0)
		local len = Util.hypot(f, s)
		local wantSprint = (keys[Enum.KeyCode.LeftShift] or keys[Enum.KeyCode.RightShift])
			and f > 0
			and me.act == ""
			and not me.ph
		me.sp = wantSprint and me.stam > 0 and len > 0 or false
		if me.sp then
			me.stam = math.max(0, me.stam - STAMINA.drain * dt)
			sinceSprint = 0
		else
			sinceSprint += dt
			if sinceSprint > STAMINA.rest then
				me.stam = math.min(1, me.stam + STAMINA.gain * dt)
			end
		end
		me.moving = 0
		if len == 0 or me.act == "crank" or me.task then
			return
		end
		local speed = (if me.sp then F.SPRINT else F.WALK * (if me.ph then F.PHONE_WALK else 1))
			* math.min(1, len)
			* dt
			/ len
		local sin, cos = math.sin(me.yaw), math.cos(me.yaw)
		-- right of forward (sin, cos) is (-cos, sin)
		me.moving = Map.slide(me, (f * sin - s * cos) * speed, (f * cos + s * sin) * speed, PLAYER_R, S.doors)
		me.bob += dt * (if me.sp then 13 else 8.5) * me.moving
	end

	local self = { me = me, torch = torch }

	-- Put the guard where the server says they are: the start of a night, or after joining.
	function self.reset(m)
		letGo()
		me.x, me.z, me.yaw, me.pitch = m.x, m.z, m.yaw or math.pi, 0
		me.on, me.ph, me.stam, me.bob, me.hold, me.watch, me.hid = false, false, 1, 0, 0, nil, -1
		me.placed = true
	end

	function self.update(state, dt: number, now: number)
		S = state
		local camera = workspace.CurrentCamera
		local m = mine()
		local live = playing() and m and m.x ~= nil and not GuiService.MenuIsOpen
		UserInputService.MouseBehavior = if live and not fixPanel.active
			then Enum.MouseBehavior.LockCenter
			else Enum.MouseBehavior.Default
		UserInputService.MouseIconEnabled = not live or fixPanel.active
		if not m or m.x == nil then
			return
		end
		if not me.placed then
			self.reset(m)
		end
		if me.flat and not m.flat then
			me.pitch = 0 -- peeled up: look ahead, not at the ceiling
		end
		me.flat = m.flat == true
		local hid = m.hid or -1
		local locker = HIDES[hid + 1]
		if hid ~= me.hid then
			me.hid = hid
			if locker then
				me.x, me.z, me.yaw, me.pitch, me.on, me.sp, me.moving =
					locker.at.x, locker.at.z, locker.face, 0, false, false, 0
			elseif not me.flat then
				me.x, me.z = m.x, m.z
			end
		end
		if locker then
			me.yaw = locker.face + math.clamp(Util.angDiff(me.yaw, locker.face), -LOCKER_LOOK.yaw, LOCKER_LOOK.yaw)
			me.pitch = math.clamp(me.pitch, -LOCKER_LOOK.pitch, LOCKER_LOOK.pitch)
		end
		if S.phase ~= "play" then
			letGo()
		end
		local stillWatching = false
		for _, p in S.players do
			if p.id == me.watch and not p.flat then
				stillWatching = true
			end
		end
		if not stillWatching or not me.flat then
			me.watch = nil
		end
		if S.phase == "play" then
			if me.flat then
				me.act, me.target, me.sp, me.hold, me.moving, me.on, me.ph = "", nil, false, 0, 0, false, false
				letGo()
			else
				if not Map.walkable(me.x, me.z, PLAYER_R * 0.5, S.doors) then
					me.x, me.z = m.x, m.z -- a door shut on top of us, or the server put us somewhere else
				end
				if not me.task then
					me.target = findTarget(m)
				end
				use(dt)
				if locker then
					me.on, me.sp, me.act, me.moving, me.x, me.z = false, false, "", 0, locker.at.x, locker.at.z
					sinceSprint += dt
					if sinceSprint > STAMINA.rest then
						me.stam = math.min(1, me.stam + STAMINA.gain * dt)
					end
				else
					walk(dt)
				end
				if me.task then
					fixPanel.tick(dt)
				end
				if m.bat <= 0 then
					me.on, me.ph = false, false
				end
			end
			if now - lastSend > SEND then
				lastSend = now
				send({
					t = "p",
					x = me.x,
					z = me.z,
					yaw = me.yaw,
					pitch = me.pitch,
					on = me.on,
					ph = me.ph,
					sp = me.sp,
					act = me.act,
				})
			end
		end
		-- Low battery: the beam dims and stutters. With hands in a box the torch hangs at the floor.
		local bat = m.bat or 1
		local weak = if bat < 0.15 then (if math.sin(now * 50) > -0.2 then 0.5 else 0.1) else 1
		torch.Brightness = if me.on and bat > 0 then TORCH_FULL * weak * (0.55 + 0.45 * math.min(1, bat * 3)) else 0
		drop += ((if me.ph or me.task then 1 else 0) - drop) * math.min(1, dt * 8)

		camera.CameraType = Enum.CameraType.Scriptable
		camera.FieldOfView = 72
		local y = if me.flat then 0.22 else EYE + math.sin(me.bob) * 0.045
		local eye
		if locker and not me.flat then
			eye = Units.eye(
				locker.x + math.sin(locker.face) * LOCKER_LOOK.eye,
				EYE - 0.05,
				locker.z + math.cos(locker.face) * LOCKER_LOOK.eye,
				me.yaw,
				me.pitch
			)
		else
			eye = Units.eye(me.x, y, me.z, me.yaw, if me.flat then math.max(0.3, me.pitch) else me.pitch)
		end
		camera.CFrame = eye
		holder.CFrame = eye
			* CFrame.new(0.22 * Units.SC, -0.18 * Units.SC, 0)
			* CFrame.Angles(-0.05 - 0.75 * drop, 0, 0)
	end

	function self.isPlaying()
		return playing()
	end
	function self.holdKey()
		return held()
	end
	return self
end

return Controller
