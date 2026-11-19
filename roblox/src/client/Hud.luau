--!nonstrict
-- The heads-up display and the cards between nights, after public/src/three/hud.js and public/src/ui.js. Kept to
-- the edges and small: the thing to look at is the dark room. Top left: the hour, the power and the faults to fix.
-- Top centre: what just happened. Bottom left: the torch. Centre: what is in reach.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Data = require(Shared.Data)
local Map = require(Shared.Map)
local Sim = require(Shared.Sim)
local Text = require(Shared.Text)

local HURRY = 15 -- seconds left before a fault burns when its row turns red
local MAX_TASKS = 6
local CELLS = 5
local LOW_BAT, LOW_POWER = 0.25, 25
local MAX_TOASTS = 3

local C = {
	text = Color3.fromHex("#cdd6f4"),
	sub = Color3.fromHex("#a6adc8"),
	panel = Color3.fromHex("#11111b"),
	red = Color3.fromHex("#f38ba8"),
	yellow = Color3.fromHex("#f9e2af"),
	green = Color3.fromHex("#a6e3a1"),
	blue = Color3.fromHex("#89b4fa"),
	peach = Color3.fromHex("#fab387"),
}
local TOAST = {
	info = C.sub,
	tip = C.blue,
	fault = C.yellow,
	fixed = C.green,
	burnt = C.red,
	out = C.red,
	back = C.green,
	torch = C.yellow,
	down = C.red,
	up = C.green,
	call = C.peach,
	hide = C.blue,
}

local function new(class: string, props, parent)
	local o = Instance.new(class)
	for k, v in props do
		o[k] = v
	end
	o.Parent = parent
	return o
end
local function label(props, parent)
	local base = {
		BackgroundTransparency = 1,
		Font = Enum.Font.Gotham,
		TextSize = 16,
		TextColor3 = C.text,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextStrokeTransparency = 0.6,
	}
	for k, v in props do
		base[k] = v
	end
	return new("TextLabel", base, parent)
end
local function bar(pos: UDim2, w: number, h: number, parent)
	local back = new("Frame", {
		Position = pos,
		Size = UDim2.fromOffset(w, h),
		BackgroundColor3 = Color3.fromHex("#313244"),
		BorderSizePixel = 0,
	}, parent)
	local fill = new("Frame", { Size = UDim2.fromScale(1, 1), BackgroundColor3 = C.green, BorderSizePixel = 0 }, back)
	return back, fill
end

local Hud = {}

function Hud.new(gui: ScreenGui, myId: string, send: (any) -> ())
	local self = {}

	-- Top left.
	local corner = new(
		"Frame",
		{ BackgroundTransparency = 1, Position = UDim2.fromOffset(16, 12), Size = UDim2.fromOffset(340, 300) },
		gui
	)
	local clock = label({ Size = UDim2.fromOffset(340, 28), Font = Enum.Font.GothamBold, TextSize = 24 }, corner)
	local powerText = label({ Position = UDim2.fromOffset(0, 32), Size = UDim2.fromOffset(340, 20) }, corner)
	local _, powerFill = bar(UDim2.fromOffset(0, 56), 220, 8, corner)
	local tasks = label({
		Position = UDim2.fromOffset(0, 72),
		Size = UDim2.fromOffset(340, 200),
		TextYAlignment = Enum.TextYAlignment.Top,
		RichText = true,
		TextSize = 15,
	}, corner)

	-- Bottom left: the torch, and stamina while winded.
	local torchText = label(
		{ AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0, 16, 1, -44), Size = UDim2.fromOffset(200, 20) },
		gui
	)
	local cells = {}
	for i = 1, CELLS do
		cells[i] = new("Frame", {
			AnchorPoint = Vector2.new(0, 1),
			Position = UDim2.new(0, 16 + (i - 1) * 22, 1, -18),
			Size = UDim2.fromOffset(18, 20),
			BackgroundColor3 = C.yellow,
			BorderSizePixel = 0,
		}, gui)
	end
	local stamBack, stamFill = bar(UDim2.new(0.5, -100, 1, -30), 200, 6, gui)

	-- Centre.
	new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(4, 4),
		BackgroundColor3 = C.text,
		BackgroundTransparency = 0.3,
		BorderSizePixel = 0,
	}, gui)
	local prompt = label({
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0.5, 28),
		Size = UDim2.fromOffset(500, 24),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 18,
	}, gui)
	local holdBack, holdFill = bar(UDim2.new(0.5, -60, 0.5, 56), 120, 5, gui)
	local status = label({
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.35),
		Size = UDim2.fromOffset(700, 60),
		TextXAlignment = Enum.TextXAlignment.Center,
		TextSize = 20,
		TextWrapped = true,
	}, gui)

	-- Top centre: the events of the night.
	local toastBox = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 12),
		Size = UDim2.fromOffset(560, 120),
		BackgroundTransparency = 1,
	}, gui)
	new("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center }, toastBox)
	local toasts = {}
	local tipsShown = {}

	-- The red edge of a scare.
	local flash = new("Frame", {
		Size = UDim2.fromScale(1, 1),
		BackgroundColor3 = Color3.fromRGB(120, 0, 0),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ZIndex = 8,
	}, gui)
	local scareText = label({
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(800, 80),
		TextXAlignment = Enum.TextXAlignment.Center,
		Font = Enum.Font.GothamBlack,
		TextSize = 40,
		ZIndex = 9,
		TextTransparency = 1,
	}, gui)
	local scareUntil = 0

	-- The card between nights.
	local card = new("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(620, 520),
		BackgroundColor3 = C.panel,
		BackgroundTransparency = 0.05,
		Visible = false,
		ZIndex = 10,
	}, gui)
	new("UICorner", { CornerRadius = UDim.new(0, 12) }, card)
	new("UIPadding", {
		PaddingLeft = UDim.new(0, 24),
		PaddingRight = UDim.new(0, 24),
		PaddingTop = UDim.new(0, 20),
		PaddingBottom = UDim.new(0, 20),
	}, card)
	local cardTitle =
		label({ Size = UDim2.new(1, 0, 0, 48), Font = Enum.Font.GothamBlack, TextSize = 40, ZIndex = 11 }, card)
	local cardSub = label({
		Position = UDim2.fromOffset(0, 52),
		Size = UDim2.new(1, 0, 0, 24),
		TextSize = 18,
		TextColor3 = C.sub,
		ZIndex = 11,
	}, card)
	local cardBody = label({
		Position = UDim2.fromOffset(0, 86),
		Size = UDim2.new(1, 0, 1, -150),
		TextYAlignment = Enum.TextYAlignment.Top,
		TextWrapped = true,
		RichText = true,
		TextSize = 15,
		ZIndex = 11,
	}, card)
	local go = new("TextButton", {
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.fromScale(0, 1),
		Size = UDim2.fromOffset(220, 44),
		BackgroundColor3 = C.blue,
		Font = Enum.Font.GothamBold,
		TextSize = 18,
		TextColor3 = C.panel,
		ZIndex = 11,
	}, card)
	new("UICorner", { CornerRadius = UDim.new(0, 8) }, go)
	go.Activated:Connect(function()
		send({ t = "next" })
	end)
	local cardKey = ""

	-- A line of what happened. kind sets the colour.
	function self.say(text: string, kind: string, seconds: number)
		local l = label({
			Size = UDim2.fromOffset(560, 0),
			AutomaticSize = Enum.AutomaticSize.Y,
			TextXAlignment = Enum.TextXAlignment.Center,
			TextWrapped = true,
			TextColor3 = TOAST[kind] or C.text,
			Text = text,
			BackgroundTransparency = 0.35,
			BackgroundColor3 = C.panel,
		}, toastBox)
		new("UIPadding", { PaddingTop = UDim.new(0, 4), PaddingBottom = UDim.new(0, 4) }, l)
		table.insert(toasts, { l = l, untilT = os.clock() + seconds })
		while #toasts > MAX_TOASTS do
			(table.remove(toasts, 1) :: any).l:Destroy()
		end
	end
	-- A tip shown once a session.
	function self.tip(key: string, text: string)
		if tipsShown[key] then
			return
		end
		tipsShown[key] = true
		self.say(text, "tip", 7)
	end
	-- I was caught: the screen goes red and says by whom.
	function self.scare(byName: string, how: string)
		scareUntil = os.clock() + 1.6
		scareText.Text = byName .. " " .. how .. "."
	end

	local function tallyText(t, run: boolean)
		if not t then
			return ""
		end
		local by = {}
		local order = {}
		for _, e in t.flats or {} do
			if not by[e[1]] then
				by[e[1]] = {}
				table.insert(order, e[1])
			end
			table.insert(by[e[1]], Data.MASC[e[2] + 1].name)
		end
		local flats = {}
		for _, name in order do
			table.insert(
				flats,
				if run then name .. " " .. #by[name] else name .. " (" .. table.concat(by[name], ", ") .. ")"
			)
		end
		local peels, pcount = {}, {}
		for _, name in t.peels or {} do
			if not pcount[name] then
				pcount[name] = 0
				table.insert(peels, name)
			end
			pcount[name] += 1
		end
		for i, name in peels do
			peels[i] = name .. " " .. pcount[name]
		end
		return string.format(
			"<b>Faults fixed</b>  %d\n<b>Left to burn</b>  %d\n<b>Flattened</b>  %s\n<b>Peeled a friend up</b>  %s",
			t.fixed or 0,
			t.burnt or 0,
			if #flats > 0 then table.concat(flats, ", ") else "Nobody",
			if #peels > 0 then table.concat(peels, ", ") else "Nobody"
		)
	end

	local function showCard(S)
		local names = {}
		for _, p in S.players do
			table.insert(names, p.name)
		end
		local who = table.concat(names, ", ")
		local key = table.concat({ S.phase, S.night, who }, "|")
		if key == cardKey then
			return
		end
		cardKey = key
		if S.phase == "lobby" then
			cardTitle.Text = "Thick Shift"
			cardSub.Text = "Midnight at the Mascot Depot"
			cardBody.Text = "<b>Guards here:</b> " .. who .. "\n\n" .. table.concat(Text.RULES, "\n\n")
			go.Text = "Start night 1"
		elseif S.phase == "win" then
			local anyFlat = false
			for _, p in S.players do
				if p.flat then
					anyFlat = true
				end
			end
			local note = if anyFlat
				then "The day shift will peel up whoever is still on the floor."
				elseif S.tally and #S.tally.flats > 0 then "Everyone is the right shape again."
				else "Nobody was flattened. They are saving it up."
			cardTitle.Text = "6 AM"
			cardSub.Text = string.format("Night %d of %d survived", S.night, Data.FINAL_NIGHT)
			cardBody.Text = note .. "\nGuards: " .. who .. "\n\n" .. tallyText(S.tally, false)
			go.Text = "Start night " .. (S.night + 1)
		elseif S.phase == "dead" then
			local m = Data.MASC[(S.killer or 0) + 1]
			cardTitle.Text = "Flattened"
			cardSub.Text = string.format("Night %d, %s", S.night, Sim.clockF(S))
			cardBody.Text = (
				if m
					then "Everyone was on the floor. " .. m.name .. " had the last of you."
					else "Everyone was on the floor."
			)
				.. "\n\n"
				.. tallyText(S.tally, false)
			go.Text = "Try night " .. S.night .. " again"
		elseif S.phase == "won" then
			cardTitle.Text = "Shift over"
			cardSub.Text = string.format("All %d nights survived", Data.FINAL_NIGHT)
			cardBody.Text = "The whole run:\n\n" .. tallyText(S.total, true)
			go.Text = "Start over"
		end
	end

	local function faultRows(S)
		local rows = {}
		local list = {}
		for i, f in S.faults or {} do
			if f then
				table.insert(list, { i = i, f = f, left = Sim.faultLeft(S, f) })
			end
		end
		table.sort(list, function(a, b)
			return a.left < b.left
		end)
		for k, r in list do
			if k > MAX_TASKS then
				table.insert(rows, string.format("<font color='#a6adc8'>and %d more</font>", #list - MAX_TASKS))
				break
			end
			local room = Map.ROOMS3[Map.BOXES[r.i].room + 1].name
			local when = if r.f.burnt then "burning" else string.format("%ds", math.max(0, math.ceil(r.left)))
			local col = if r.f.burnt or r.left < HURRY then "#f38ba8" else "#f9e2af"
			table.insert(
				rows,
				string.format("<font color='%s'>%s, %s  %s</font>", col, Text.FAULT_NAME[r.f.k + 1], room, when)
			)
		end
		return table.concat(rows, "\n")
	end

	-- me: the controller's view of this guard.
	function self.update(S, me)
		local now = os.clock()
		for i = #toasts, 1, -1 do
			if now > toasts[i].untilT then
				toasts[i].l:Destroy()
				table.remove(toasts, i)
			end
		end
		local k = math.clamp((scareUntil - now) / 1.6, 0, 1)
		flash.BackgroundTransparency = 1 - 0.75 * k
		scareText.TextTransparency = 1 - k

		local playing = S.phase == "play"
		card.Visible = not playing and now > scareUntil
		if card.Visible then
			showCard(S)
		else
			cardKey = ""
		end
		local mine
		for _, p in S.players do
			if p.id == myId then
				mine = p
			end
		end
		local show = playing and mine ~= nil and mine.x ~= nil
		corner.Visible, torchText.Visible, prompt.Visible = show, show, show
		for _, c in cells do
			c.Visible = show
		end
		if not show then
			stamBack.Visible, holdBack.Visible, status.Visible = false, false, false
			return
		end

		clock.Text = string.format("%s   Night %d", Sim.clockF(S), S.night)
		if S.out then
			powerText.Text = string.format("Power out. Crank: %d%%", math.floor(math.min(1, S.restart or 0) * 100))
			powerText.TextColor3 = C.red
			powerFill.Size = UDim2.fromScale(math.min(1, S.restart or 0), 1)
			powerFill.BackgroundColor3 = C.red
		else
			powerText.Text = string.format(
				"Power %d%%%s",
				math.ceil(S.power),
				if S.cap < 100 then string.format("  (holds %d%%)", math.floor(S.cap)) else ""
			)
			powerText.TextColor3 = if S.power < LOW_POWER then C.red else C.text
			powerFill.Size = UDim2.fromScale(S.power / 100, 1)
			powerFill.BackgroundColor3 = if S.power < LOW_POWER then C.red else C.green
		end
		tasks.Text = faultRows(S)

		local bat = mine.bat or 0
		torchText.Text = if me.on then "Torch on" else "Torch off  (F)"
		torchText.TextColor3 = if bat < LOW_BAT then C.red else C.text
		for i, c in cells do
			local lit = bat * CELLS >= i - 0.5
			c.BackgroundTransparency = if lit then 0 else 0.8
			c.BackgroundColor3 = if bat < LOW_BAT then C.red else C.yellow
		end
		stamBack.Visible = me.stam < 0.99
		stamFill.Size = UDim2.fromScale(me.stam, 1)

		local t = me.target
		prompt.Text = if t and not me.flat and not me.task then "[E]  " .. t.label else ""
		holdBack.Visible = t ~= nil and t.hold > 0 and me.hold > 0
		if holdBack.Visible then
			holdFill.Size = UDim2.fromScale(math.min(1, me.hold / t.hold), 1)
		end

		status.Visible = true
		if me.flat then
			status.Text = if me.watch
				then "Flat. Watching a teammate. Space for the next, Q to call for help."
				else "You are flat. Q calls for help. Space watches a teammate."
		elseif me.hid >= 0 then
			status.Text = "In the locker. E steps out."
		else
			status.Text = ""
		end
	end

	return self
end

return Hud
