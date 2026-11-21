-- Runs the client modules against the real sim outside Roblox, to catch runtime errors without Studio: a night is
-- played with a scripted guard pressing keys, and every frame the world, the controller, the actors and the HUD
-- update from S. Lune's roblox library builds real instances and refuses unknown properties and enum values; the
-- input services are stubs. It cannot show what anything looks like.
--
--   lune run apps/roblox/test/smoke.luau

local fs = require("@lune/fs")
local luau = require("@lune/luau")
local roblox = require("@lune/roblox")

local Sim = require("../src/shared/Sim")
local Map = require("../src/shared/Map")
local shared = {
	Data = require("../src/shared/Data"),
	Map = Map,
	Sim = Sim,
	Util = require("../src/shared/Util"),
	Units = nil,
	Text = nil,
}

local datamodel = roblox.Instance.new("DataModel")
local workspace = datamodel:GetService("Workspace")
local camera = roblox.Instance.new("Camera")
camera.Parent = workspace;
(workspace :: any).CurrentCamera = camera

-- Stand-ins for the runtime services.
local function signal()
	local s = { fns = {} }
	function s:Connect(f)
		table.insert(self.fns, f)
		return { Disconnect = function() end }
	end
	function s:Fire(...)
		for _, f in self.fns do
			f(...)
		end
	end
	return s
end
local cas = { bound = {} }
function cas:BindActionAtPriority(name, f)
	self.bound[name] = f
end
local uis = {
	InputBegan = signal(),
	InputEnded = signal(),
	InputChanged = signal(),
	WindowFocusReleased = signal(),
	MouseBehavior = roblox.Enum.MouseBehavior.Default,
	MouseIconEnabled = true,
}
function uis:GetFocusedTextBox()
	return nil
end
local stubs = {
	UserInputService = uis,
	ContextActionService = cas,
	GuiService = { MenuIsOpen = false },
	RunService = { RenderStepped = signal(), Heartbeat = signal() },
	ReplicatedStorage = {
		WaitForChild = function(_, name)
			assert(name == "Shared", name)
			return shared
		end,
	},
}
local game = {
	GetService = function(_, name)
		return stubs[name] or datamodel:GetService(name)
	end,
}

-- Lune's instances have properties but no events. Buttons get stubs that never fire.
for _, event in { "Activated", "MouseButton1Down", "MouseButton1Up", "MouseLeave" } do
	roblox.implementProperty("TextButton", event, function()
		return signal()
	end)
end

local delayed = {}
local env = setmetatable({
	game = game,
	workspace = workspace,
	Instance = roblox.Instance,
	Enum = roblox.Enum,
	Vector3 = roblox.Vector3,
	Vector2 = roblox.Vector2,
	CFrame = roblox.CFrame,
	Color3 = roblox.Color3,
	UDim = roblox.UDim,
	UDim2 = roblox.UDim2,
	NumberRange = roblox.NumberRange,
	NumberSequence = roblox.NumberSequence,
	ColorSequence = roblox.ColorSequence,
	task = {
		delay = function(_, f)
			table.insert(delayed, f)
		end,
	},
	script = nil,
	require = function(x)
		assert(type(x) == "table", "require of a non-module")
		return x
	end,
}, { __index = _G })

local function load(path: string)
	local chunk = luau.load(fs.readFile(path), { debugName = path, environment = env })
	return chunk()
end
shared.Units = load("apps/roblox/src/shared/Units.luau")
shared.Text = load("apps/roblox/src/shared/Text.luau")
local World = load("apps/roblox/src/client/World.luau")
local Task = load("apps/roblox/src/client/Task.luau")
local Controller = load("apps/roblox/src/client/Controller.luau")
local Hud = load("apps/roblox/src/client/Hud.luau")
local Actors = load("apps/roblox/src/client/Actors.luau")

local sim = Sim.new("")
sim:addPlayer("1", "Me")
sim:addPlayer("2", "Friend")
local function send(a)
	if a.t == "next" then
		return
	end
	sim:act("1", a)
end

local gui = roblox.Instance.new("ScreenGui")
local world = World.build()
local fixPanel = Task.new(gui)
local controller = Controller.new("1", send, fixPanel)
local hud = Hud.new(gui, "1", send)
local actors = Actors.new()

-- Drive the controller through the key binding it registered.
local press = cas.bound.ThickShiftKeys
local function key(code, down)
	press(
		"ThickShiftKeys",
		if down then roblox.Enum.UserInputState.Begin else roblox.Enum.UserInputState.End,
		{ KeyCode = code }
	)
end

-- Main.client.luau puts the guard where the server says when a night begins.
local function startNight(n)
	sim:startNight(n)
	controller.reset(sim.S.players[1])
end

local K = roblox.Enum.KeyCode
startNight(1)
hud.update(sim.S, controller.me) -- the card is up between nights; this draws it with the night started instead
local frames, t, dt = 0, 0, 1 / 30
local acc = 0
local phases = {}
for _ = 1, 30 * 300 do
	t += dt
	frames += 1
	acc += dt
	if acc >= 0.1 then
		sim:step(acc)
		acc = 0
	end
	local S = sim.S
	-- The scripted guard: walk and turn, torch on, press E at whatever is in reach.
	local second = math.floor(t)
	key(K.W, second % 6 < 4)
	key(K.LeftShift, second % 10 == 0)
	if frames % 90 == 0 then
		key(K.F, true)
		key(K.F, false)
	end
	if frames % 7 == 0 then
		uis.InputChanged:Fire({
			UserInputType = roblox.Enum.UserInputType.MouseMovement,
			Delta = roblox.Vector2.new(if second % 8 < 4 then 9 else -7, 0),
		})
	end
	key(K.E, frames % 20 < 12)
	if fixPanel.active then
		uis.InputBegan:Fire({ KeyCode = K.X })
	end
	controller.update(S, dt, t)
	actors.sync(S, dt, t, "1")
	world.update(S, t, dt, camera.CFrame.Position, Sim.dreadF(S), 0.5)
	hud.update(S, controller.me)
	phases[S.phase] = true
	if S.phase ~= "play" then
		hud.update(S, controller.me)
		startNight(S.night)
	end
end
for _, f in delayed do
	f()
end

-- Each minigame, played to the end through its keys.
for k = 0, 2 do
	local done = false
	fixPanel.open(0, k, function()
		done = true
	end, function() end)
	for _ = 1, 600 do
		if done then
			break
		end
		if k == 2 then
			-- Watch the needle: open the valve below the middle of the green, let go above it.
			local held = if fixPanel.peek().p < 0.69 then uis.InputBegan else uis.InputEnded
			held:Fire({ KeyCode = K.E })
			fixPanel.tick(1 / 30)
		else
			-- Read the tags (breaker) or try each socket in turn (wires), as a player would.
			local digits = { K.One, K.Two, K.Three, K.Four, K.Five }
			local job = fixPanel.peek()
			for _, n in (if job and job.order then job.order else { 1, 2, 3, 4 }) do
				uis.InputBegan:Fire({ KeyCode = digits[n] })
			end
		end
	end
	assert(done, string.format("minigame %d was not finished", k))
end

-- The cards between nights.
for _, phase in { "lobby", "win", "dead", "won" } do
	sim.S.phase = phase
	sim.S.total = sim.S.total or sim.S.tally
	hud.update(sim.S, controller.me)
end

local count = 0
for _ in workspace:GetDescendants() do
	count += 1
end
local seen = {}
for p in phases do
	table.insert(seen, p)
end
print(
	string.format(
		"OK: %d frames, %d instances in the world, phases seen: %s, guard at %.1f, %.1f",
		frames,
		count,
		table.concat(seen, " "),
		controller.me.x,
		controller.me.z
	)
)
