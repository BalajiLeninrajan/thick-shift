--!strict
-- The server is what the web game's room is (packages/game/worker/room.ts): it owns the one Sim, steps it ten times
-- a second, and sends every client the whole state. Clients send the same actions a guard's browser sends
-- (Shared/Sim.luau act), plus 'next' from the cards between nights, which any guard may press.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Sim = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Sim"))

local TICK = 0.1
-- Actions a client may send a second: twelve position updates and the odd press, with room to spare.
local RATE = 40

local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local actEvent = Instance.new("RemoteEvent")
actEvent.Name = "Act"
actEvent.Parent = remotes
local stateEvent = Instance.new("RemoteEvent")
stateEvent.Name = "State"
stateEvent.Parent = remotes
remotes.Parent = ReplicatedStorage

local rng = Random.new()
local sim = Sim.new("", function()
	return rng:NextNumber()
end)

local function idOf(player: Player): string
	return tostring(player.UserId)
end

local function join(player: Player)
	sim:addPlayer(idOf(player), string.sub(player.DisplayName, 1, 12))
end
Players.PlayerAdded:Connect(join)
for _, player in Players:GetPlayers() do
	join(player)
end
Players.PlayerRemoving:Connect(function(player)
	sim:removePlayer(idOf(player))
end)

-- From a card between nights: start the next night, try this one again, or start the run over.
local lastAdvance = 0
local function advance()
	local S = sim.S
	if S.phase == "play" or os.clock() - lastAdvance < 1 then
		return
	end
	lastAdvance = os.clock()
	if S.phase == "lobby" then
		sim:startNight(1)
	elseif S.phase == "win" then
		sim:startNight(S.night + 1)
	elseif S.phase == "dead" then
		sim:startNight(S.night)
	elseif S.phase == "won" then
		sim:restart()
	end
end

local budget: { [Player]: { t: number, n: number } } = {}
Players.PlayerRemoving:Connect(function(player)
	budget[player] = nil
end)

actEvent.OnServerEvent:Connect(function(player: Player, a: any)
	if type(a) ~= "table" or type(a.t) ~= "string" then
		return
	end
	local now = os.clock()
	local b = budget[player]
	if not b or now - b.t >= 1 then
		b = { t = now, n = 0 }
		budget[player] = b :: any
	end
	local used = b :: any
	used.n += 1
	if used.n > RATE then
		return
	end
	if a.t == "next" then
		advance()
	elseif a.t ~= "name" then -- names come from Roblox
		sim:act(idOf(player), a)
	end
end)

-- What goes over the wire. The tallies only matter on the cards between nights, and grow through a run.
local function snapshot()
	local S = sim.S
	if S.phase ~= "play" then
		return S
	end
	local out = {}
	for k, v in S do
		if k ~= "tally" and k ~= "total" then
			out[k] = v
		end
	end
	return out
end

local acc = 0
RunService.Heartbeat:Connect(function(dt)
	acc += dt
	if acc < TICK then
		return
	end
	sim:step(acc)
	acc = 0
	stateEvent:FireAllClients(snapshot())
end)
