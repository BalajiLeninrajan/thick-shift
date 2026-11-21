--!nonstrict
-- The frame, after packages/game/src/three/app.ts: the server's state comes in ten times a second, and every frame the
-- world, this guard, the others and the HUD are drawn from it. New events become lines on the HUD.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local StarterGui = game:GetService("StarterGui")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Data = require(Shared.Data)
local Map = require(Shared.Map)
local Sim = require(Shared.Sim)
local Text = require(Shared.Text)
local Util = require(Shared.Util)

local World = require(script.Parent:WaitForChild("World"))
local Controller = require(script.Parent:WaitForChild("Controller"))
local Task = require(script.Parent:WaitForChild("Task"))
local Hud = require(script.Parent:WaitForChild("Hud"))
local Actors = require(script.Parent:WaitForChild("Actors"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local actEvent = remotes:WaitForChild("Act")
local stateEvent = remotes:WaitForChild("State")

local player = Players.LocalPlayer
local myId = tostring(player.UserId)

pcall(function()
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
	StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Health, false)
end)

local gui = Instance.new("ScreenGui")
gui.Name = "ThickShift"
gui.IgnoreGuiInset = true
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local function send(a)
	actEvent:FireServer(a)
end

local world = World.build()
local fixPanel = Task.new(gui)
local controller = Controller.new(myId, send, fixPanel)
local hud = Hud.new(gui, myId, send)
local actors = Actors.new()

local S = nil
stateEvent.OnClientEvent:Connect(function(state)
	S = state
end)

local function guard(id)
	return Util.find(S.players, function(p)
		return p.id == id
	end)
end
local function isMe(id)
	return id == myId
end
local function roomName(i)
	local r = Map.ROOMS3[i + 1]
	return r and r.name or "dark"
end
local function where(x)
	return "in the " .. roomName(Map.roomAt(x.x, x.z))
end

-- What each new event means on this screen. Sounds would go here too, once the recordings are uploaded.
local SAY = {
	fault = function(e)
		local f = S.faults[e.x.i + 1]
		if not f then
			return
		end
		hud.say(
			string.format(
				"Fault in the %s: %s.",
				roomName(Map.BOXES[e.x.i + 1].room),
				string.lower(Text.FAULT_NAME[f.k + 1])
			),
			"fault",
			4
		)
		hud.tip(
			"fault",
			"Faults leak power until they are fixed, and darken their room. The list under the power leads to them. Press E at the box."
		)
	end,
	fix = function(e)
		local left = Util.count(S.faults, function(f)
			return f ~= false
		end)
		local rest = if left > 0 then left .. " still open." else "All clear."
		if isMe(e.x.by) then
			hud.say("Fixed. " .. rest, "fixed", 3)
		else
			local g = guard(e.x.by)
			hud.say(
				string.format(
					"%s fixed the %s. %s",
					g and g.name or "Someone",
					roomName(Map.BOXES[e.x.i + 1].room),
					rest
				),
				"fixed",
				3
			)
		end
	end,
	burn = function()
		hud.say("A fault is burning out the wiring. Fix it before the building cannot hold a charge.", "burnt", 6)
	end,
	out = function()
		hud.say("The power is out. Every door is open.", "out", 7)
	end,
	on = function()
		hud.say("The power is back.", "back", 3)
	end,
	flat = function(e)
		local m = Data.MASC[e.x.by + 1]
		if isMe(e.x.id) then
			hud.scare(m.name, Text.HOW[e.x.by + 1])
		else
			local who = guard(e.x.id)
			if who then
				hud.say(string.format("%s flattened %s %s.", m.name, who.name, where(e.x)), "down", 6)
				hud.tip("peel", "A flat guard stays flat until someone stands over them and holds E.")
			end
		end
	end,
	peel = function(e)
		if isMe(e.x.id) then
			hud.say("Peeled up. They will not notice you for a few seconds. Go.", "up", 4)
		else
			local by, who = guard(e.x.by), guard(e.x.id)
			hud.say(
				string.format(
					"%s peeled %s up.",
					if isMe(e.x.by) then "You" else (by and by.name or "Someone"),
					who and who.name or "someone"
				),
				"up",
				3
			)
		end
	end,
	call = function(e)
		if not isMe(e.x.id) then
			local g = guard(e.x.id)
			hud.say(string.format("%s is calling from the floor %s.", g and g.name or "Someone", where(e.x)), "call", 4)
		end
	end,
	spot = function(e)
		if isMe(e.x.id) then
			hud.tip(
				"spot",
				"It has seen you. Keep the torch on it and back away. The beam holds it while the battery lasts."
			)
		end
	end,
	bat = function(e)
		if isMe(e.x.by) then
			hud.say("Fresh battery.", "torch", 2.5)
		end
	end,
	locker = function(e)
		if isMe(e.x.id) and e.x["in"] then
			hud.tip(
				"hide",
				"Nothing sees you in here. One that saw you get in will open the door. One that stands outside long enough will sniff you out."
			)
		end
	end,
	found = function(e)
		local m = Data.MASC[e.x.i + 1]
		if isMe(e.x.id) then
			hud.say(m.name .. " opened the locker. Run!", "hide", 3)
		else
			local g = guard(e.x.id)
			hud.say(
				string.format("%s found %s in a locker %s.", m.name, g and g.name or "someone", where(e.x)),
				"hide",
				6
			)
		end
	end,
	fumble = function(e)
		if isMe(e.x.by) then
			hud.say("The door will not shut. Something is standing in it.", "info", 3)
		end
	end,
}

-- How scared this guard should be right now, 0 to 1: something hunting, close.
local function threat(me)
	local worst = 0
	for _, m in S.m do
		if m.st == "hunt" or m.st == "windup" or m.st == "charge" or m.st == "search" then
			local k = (if m.st == "search" then 0.5 else 1)
				* math.max(0, 1 - math.sqrt((m.x - me.x) ^ 2 + (m.z - me.z) ^ 2) / 16)
			worst = math.max(worst, k)
		end
	end
	return worst
end

local lastEv, lastT = 0, 1e9
local catchUntil, catchBy = 0, -1
RunService.RenderStepped:Connect(function(dt)
	if not S then
		return
	end
	dt = math.min(0.1, dt)
	local now = os.clock()
	local mine = guard(myId)
	-- A night began: put the guard where the server says.
	if S.t < lastT and mine and mine.x then
		controller.reset(mine)
	end
	if mine and mine.x then
		lastT = S.t
	end
	for _, e in S.evs do
		if e.id > lastEv then
			lastEv = e.id
			local f = SAY[e.type]
			if f then
				f(e)
			end
			if e.type == "flat" and isMe(e.x.id) then
				catchUntil, catchBy = now + Hud.CATCH, e.x.by
			end
		end
	end
	controller.update(S, dt, now)
	actors.sync(S, dt, now, myId)
	local me = controller.me
	-- The catch: the camera looks up at what sat on this guard.
	if now < catchUntil then
		local head = actors.headOf(catchBy)
		if head then
			local cam = workspace.CurrentCamera
			cam.CFrame = CFrame.lookAt(cam.CFrame.Position, head.Position)
		end
	elseif me.flat and me.watch then
		local eye = actors.eyeOf(me.watch)
		if eye then
			workspace.CurrentCamera.CFrame = eye
		end
	end
	world.update(
		S,
		now,
		dt,
		workspace.CurrentCamera.CFrame.Position,
		Sim.dreadF(S),
		if S.phase == "play" then threat(me) else 0
	)
	hud.update(S, me)
end)
