--!nonstrict
-- The fault minigames, ported from packages/game/src/three/task.js: a panel over the bottom of the screen while a guard
-- has their hands in a breaker box. The server is told only when the job is done.
--   0 breaker: flip the tripped switches back in the order on their tags
--   1 wires:   join the lit wire on the left to its colour on the right
--   2 valve:   hold to open the valve and keep the needle in the green
-- Keys: A D or W S or the number keys to choose, E or Space to act, X to let go. Mouse: click the parts.

local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Map = require(Shared.Map)
local Text = require(Shared.Text)

local WIRES = { { "#f38ba8", "red" }, { "#f9e2af", "yellow" }, { "#89b4fa", "blue" }, { "#a6e3a1", "green" } }
local VALVE = { rise = 0.9, fall = 1.1, wobble = 0.35, band = { 0.58, 0.8 }, need = 1.3 }

local function shuffle(list)
	for i = #list, 2, -1 do
		local j = math.random(1, i)
		list[i], list[j] = list[j], list[i]
	end
	return list
end

local function new(class: string, props, parent)
	local o = Instance.new(class)
	for k, v in props do
		o[k] = v
	end
	o.Parent = parent
	return o
end

local Task = {}

function Task.new(gui: ScreenGui)
	local panel = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 1),
		Position = UDim2.new(0.5, 0, 1, -24),
		Size = UDim2.fromOffset(560, 250),
		BackgroundColor3 = Color3.fromHex("#181825"),
		BackgroundTransparency = 0.08,
		Visible = false,
	}, gui)
	new("UICorner", { CornerRadius = UDim.new(0, 10) }, panel)
	local stroke = new("UIStroke", { Color = Color3.fromHex("#45475a"), Thickness = 2 }, panel)
	local title = new("TextLabel", {
		BackgroundTransparency = 1,
		Position = UDim2.fromOffset(16, 10),
		Size = UDim2.new(1, -32, 0, 24),
		Font = Enum.Font.GothamBold,
		TextSize = 20,
		TextColor3 = Color3.fromHex("#cdd6f4"),
		TextXAlignment = Enum.TextXAlignment.Left,
	}, panel)
	local where = new("TextLabel", {
		BackgroundTransparency = 1,
		Position = UDim2.fromOffset(16, 10),
		Size = UDim2.new(1, -32, 0, 24),
		Font = Enum.Font.Gotham,
		TextSize = 16,
		TextColor3 = Color3.fromHex("#a6adc8"),
		TextXAlignment = Enum.TextXAlignment.Right,
	}, panel)
	local body = new(
		"Frame",
		{ BackgroundTransparency = 1, Position = UDim2.fromOffset(16, 44), Size = UDim2.new(1, -32, 0, 150) },
		panel
	)
	local help = new("TextLabel", {
		BackgroundTransparency = 1,
		Position = UDim2.new(0, 16, 1, -50),
		Size = UDim2.new(1, -32, 0, 40),
		Font = Enum.Font.Gotham,
		TextSize = 14,
		TextWrapped = true,
		TextColor3 = Color3.fromHex("#a6adc8"),
		TextXAlignment = Enum.TextXAlignment.Left,
	}, panel)

	local job, onDone, onQuit = nil, nil, nil

	local function buzz()
		stroke.Color = Color3.fromHex("#f38ba8")
		task.delay(0.25, function()
			stroke.Color = Color3.fromHex("#45475a")
		end)
	end

	local function button(x, y, w, h, color)
		local b = new("TextButton", {
			Position = UDim2.fromOffset(x, y),
			Size = UDim2.fromOffset(w, h),
			BackgroundColor3 = color,
			AutoButtonColor = false,
			Font = Enum.Font.GothamBold,
			TextSize = 18,
			TextColor3 = Color3.fromHex("#11111b"),
			Text = "",
		}, body)
		new("UICorner", { CornerRadius = UDim.new(0, 6) }, b)
		return b
	end
	local function selectStroke(b, on)
		local s = b:FindFirstChildOfClass("UIStroke")
			or new("UIStroke", { Thickness = 3, ApplyStrokeMode = Enum.ApplyStrokeMode.Border }, b)
		s.Color = Color3.fromHex("#f9e2af")
		s.Enabled = on
	end

	-- Each job: { draw(), move(dx, dy), pick(n), act(down), tick(dt)?, done, help }. Indices 1-based here.
	local function breaker()
		local n = 5
		local tripped = table.move(shuffle({ 1, 2, 3, 4, 5 }), 1, 3, 1, {})
		local order = shuffle(table.clone(tripped))
		local up = {}
		for i = 1, n do
			up[i] = not table.find(tripped, i)
		end
		local j = {
			sel = 1,
			next = 1,
			done = false,
			help = "Flip the tripped switches up in the order on their tags. A D or 1 to 5 to choose, E to flip.",
		}
		j.order = order -- what the tags say, for roblox/test/smoke.luau
		local buttons = {}
		local function draw()
			for i = 1, n do
				local b = buttons[i]
				b.BackgroundColor3 = if up[i] then Color3.fromHex("#a6e3a1") else Color3.fromHex("#585b70")
				local tag = table.find(order, i)
				b.Text = (if up[i] then "UP" else "DOWN\n" .. tostring(tag)) .. "\n\n" .. i
				selectStroke(b, i == j.sel)
			end
		end
		local function flip(i)
			if up[i] then
				return
			end
			if i == order[j.next] then
				up[i] = true
				j.next += 1
				j.done = j.next > #order
			else
				buzz()
				for k = 1, j.next - 1 do
					up[order[k]] = false -- the wrong one trips them all again
				end
				j.next = 1
			end
			draw()
		end
		for i = 1, n do
			local b = button((i - 1) * 104 + 6, 0, 92, 140, Color3.fromHex("#585b70"))
			b.Activated:Connect(function()
				j.sel = i
				flip(i)
			end)
			buttons[i] = b
		end
		j.draw = draw
		function j.move(dx)
			if dx ~= 0 then
				j.sel = (j.sel - 1 + dx) % n + 1
				draw()
			end
		end
		function j.pick(i)
			if i <= n then
				j.sel = i
				flip(i)
			end
		end
		function j.act(down)
			if down then
				flip(j.sel)
			end
		end
		return j
	end

	local function wires()
		local right = shuffle({ 1, 2, 3, 4 })
		local joined = {}
		local j =
			{ sel = 1, done = false, help = "Join the lit wire to its colour. W S or 1 to 4 to choose, E to join." }
		local ends, sockets = {}, {}
		local function live()
			for w = 1, 4 do
				if not joined[w] then
					return w
				end
			end
			return nil
		end
		local function draw()
			local now = live()
			for w = 1, 4 do
				local e = ends[w]
				e.BackgroundTransparency = if joined[w] or w == now then 0 else 0.6
				selectStroke(e, w == now)
			end
			for s = 1, 4 do
				local b = sockets[s]
				b.BackgroundTransparency = if joined[right[s]] then 0 else 0.35
				b.Text = if joined[right[s]] then "joined" else tostring(s)
				selectStroke(b, s == j.sel)
			end
		end
		local function join(s)
			if right[s] == live() then
				joined[right[s]] = true
				local n = 0
				for _ in joined do
					n += 1
				end
				j.done = n == 4
			else
				buzz()
			end
			draw()
		end
		for w = 1, 4 do
			ends[w] = button(10, (w - 1) * 36 + 2, 120, 30, Color3.fromHex(WIRES[w][1]))
		end
		for s = 1, 4 do
			local b = button(388, (s - 1) * 36 + 2, 120, 30, Color3.fromHex(WIRES[right[s]][1]))
			b.Activated:Connect(function()
				j.sel = s
				join(s)
			end)
			sockets[s] = b
		end
		j.draw = draw
		function j.move(_, dy)
			if dy ~= 0 then
				j.sel = (j.sel - 1 + dy) % 4 + 1
				draw()
			end
		end
		function j.pick(s)
			if s <= 4 then
				j.sel = s
				join(s)
			end
		end
		function j.act(down)
			if down then
				join(j.sel)
			end
		end
		return j
	end

	local function valve()
		local j = {
			p = 0,
			held = false,
			inBand = 0,
			t = math.random() * 9,
			done = false,
			help = "Hold E to open the valve. Keep the needle in the green until the bar fills. Too far and it blows back.",
		}
		local track = new("Frame", {
			Position = UDim2.fromOffset(0, 20),
			Size = UDim2.new(1, 0, 0, 40),
			BackgroundColor3 = Color3.fromHex("#313244"),
		}, body)
		new("Frame", {
			Position = UDim2.fromScale(VALVE.band[1], 0),
			Size = UDim2.fromScale(VALVE.band[2] - VALVE.band[1], 1),
			BackgroundColor3 = Color3.fromHex("#40a02b"),
			BorderSizePixel = 0,
		}, track)
		local needle = new("Frame", {
			Size = UDim2.new(0, 6, 1, 10),
			Position = UDim2.fromScale(0, -0.125),
			BackgroundColor3 = Color3.fromHex("#cdd6f4"),
			BorderSizePixel = 0,
		}, track)
		local bar = new("Frame", {
			Position = UDim2.fromOffset(0, 90),
			Size = UDim2.new(1, 0, 0, 16),
			BackgroundColor3 = Color3.fromHex("#313244"),
		}, body)
		local fill = new(
			"Frame",
			{ Size = UDim2.fromScale(0, 1), BackgroundColor3 = Color3.fromHex("#a6e3a1"), BorderSizePixel = 0 },
			bar
		)
		local hold = button(200, 116, 120, 30, Color3.fromHex("#89b4fa"))
		hold.Text = "Hold"
		hold.MouseButton1Down:Connect(function()
			j.held = true
		end)
		hold.MouseButton1Up:Connect(function()
			j.held = false
		end)
		hold.MouseLeave:Connect(function()
			j.held = false
		end)
		function j.draw() end
		function j.move() end
		function j.pick() end
		function j.act(down)
			j.held = down
		end
		function j.tick(dt)
			j.t += dt
			j.p += (if j.held then VALVE.rise else -VALVE.fall) * dt + math.sin(j.t * 7.3) * math.sin(j.t * 2.1) * VALVE.wobble * dt
			if j.p > 1 then
				j.p = 0.2 -- blew back
				j.inBand = math.max(0, j.inBand - 0.6)
				buzz()
			end
			j.p = math.max(0, j.p)
			local ok = j.p > VALVE.band[1] and j.p < VALVE.band[2]
			j.inBand = math.max(0, j.inBand + (if ok then dt else -dt * 0.5))
			j.done = j.inBand >= VALVE.need
			needle.Position = UDim2.new(math.min(1, j.p), -3, -0.125, 0)
			fill.Size = UDim2.fromScale(math.min(1, j.inBand / VALVE.need), 1)
		end
		return j
	end

	local self = { active = false }

	local function close()
		job, onDone, onQuit = nil, nil, nil
		self.active = false
		panel.Visible = false
		body:ClearAllChildren()
	end
	local function check()
		if job and job.done then
			local done = onDone
			close()
			if done then
				done()
			end
		end
	end
	local function quit()
		local q = onQuit
		close()
		if q then
			q()
		end
	end

	local DIGITS = { Enum.KeyCode.One, Enum.KeyCode.Two, Enum.KeyCode.Three, Enum.KeyCode.Four, Enum.KeyCode.Five }
	local DIRS = {
		[Enum.KeyCode.W] = { 0, -1 },
		[Enum.KeyCode.S] = { 0, 1 },
		[Enum.KeyCode.A] = { -1, 0 },
		[Enum.KeyCode.D] = { 1, 0 },
	}
	UserInputService.InputBegan:Connect(function(input)
		if not job or UserInputService:GetFocusedTextBox() then
			return
		end
		local c = input.KeyCode
		if c == Enum.KeyCode.X then
			quit()
			return
		end
		local dir = DIRS[c]
		local digit = table.find(DIGITS, c)
		if dir then
			job.move(dir[1], dir[2])
		elseif digit then
			job.pick(digit)
		elseif c == Enum.KeyCode.E or c == Enum.KeyCode.Space then
			job.act(true)
		end
		check()
	end)
	UserInputService.InputEnded:Connect(function(input)
		if job and (input.KeyCode == Enum.KeyCode.E or input.KeyCode == Enum.KeyCode.Space) then
			job.act(false)
		end
	end)

	-- i: the box (0-based); k: the kind (0-based). done: called once the job is finished; quit: when the guard lets go.
	function self.open(i: number, k: number, done, quit_)
		body:ClearAllChildren()
		job = ({ breaker, wires, valve })[k + 1]()
		onDone, onQuit = done, quit_
		title.Text = Text.FAULT_NAME[k + 1]
		where.Text = Map.ROOMS3[Map.BOXES[i + 1].room + 1].name .. "   (X lets go)"
		help.Text = job.help
		job.draw()
		panel.Visible = true
		self.active = true
	end
	self.close = close
	-- The job in hand, for roblox/test/smoke.luau.
	function self.peek()
		return job
	end
	function self.tick(dt)
		if job and job.tick then
			job.tick(dt)
			check()
		end
	end
	return self
end

return Task
