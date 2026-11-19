-- Replays a night recorded from the web sim (tools/roblox/diff/run.sh) through the Luau port and stops at the first
-- tick where they disagree. Run through run.sh, or: lune run roblox/test/diff-sim.luau <rec.jsonl>

local fs = require("@lune/fs")
local serde = require("@lune/serde")
local process = require("@lune/process")

local Sim = require("../src/shared/Sim")

local path = process.args[1]
assert(path, "usage: lune run diff-sim.luau <rec.jsonl>")

-- Numbers may differ in the last bits where the two languages' libm (atan2, sin, cos) round differently.
local TOL = 1e-6
-- EXACT=1 also reports, once, the first tick where any number differs at all.
local EXACT = process.env.EXACT == "1"
local firstExact: string? = nil

local function compare(js: any, lu: any, at: string, out: { string })
	if #out >= 12 then
		return
	end
	-- JS null was written as false; Luau leaves such fields nil or false.
	if (js == nil or js == false) and (lu == nil or lu == false) then
		return
	end
	if type(js) == "number" and type(lu) == "number" then
		if EXACT and js ~= lu and not firstExact then
			firstExact = string.format("%s: js %.17g, luau %.17g", at, js, lu)
		end
		if math.abs(js - lu) > TOL * math.max(1, math.abs(js)) then
			table.insert(out, string.format("%s: js %.17g, luau %.17g", at, js, lu))
		end
		return
	end
	if type(js) ~= type(lu) then
		table.insert(out, string.format("%s: js %s, luau %s", at, tostring(js), tostring(lu)))
		return
	end
	if type(js) == "table" then
		local keys = {}
		for k in js do
			keys[k] = true
		end
		for k in lu do
			keys[k] = true
		end
		local sorted = {}
		for k in keys do
			table.insert(sorted, k)
		end
		table.sort(sorted, function(a, b)
			return tostring(a) < tostring(b)
		end)
		for _, k in sorted do
			compare(js[k], lu[k], at .. "." .. tostring(k), out)
		end
		return
	end
	if js ~= lu then
		table.insert(out, string.format("%s: js %s, luau %s", at, tostring(js), tostring(lu)))
	end
end

-- rec.mjs writes numbers as "#<number>" strings (see there); turn them back into numbers.
local function revive(v: any): any
	if type(v) == "string" and string.sub(v, 1, 1) == "#" then
		return tonumber(string.sub(v, 2))
	elseif type(v) == "table" then
		for k, x in v do
			v[k] = revive(x)
		end
	end
	return v
end

local queue: { number } = {}
local used = 0
local function rng(): number
	used += 1
	local v = queue[used]
	if v == nil then
		error("the port drew more random numbers than the web sim did", 2)
	end
	return v
end

local sim
local ticks, acts = 0, 0
local lineNo = 0
for line in string.gmatch(fs.readFile(path), "[^\n]+") do
	lineNo += 1
	local e = revive(serde.decode("json", line))
	queue, used = e.rands, 0
	local ok, err = pcall(function()
		if e.op == "start" then
			if not sim then
				sim = Sim.new("TEST", rng)
				for _, p in e.players do
					sim:addPlayer(p.id, p.name)
				end
			end
			sim:startNight(e.n)
		elseif e.op == "step" then
			ticks += 1
			sim:step(e.dt)
		elseif e.op == "act" then
			acts += 1
			sim:act(e.id, e.a)
		end
	end)
	local problems = {}
	if not ok then
		table.insert(problems, "error: " .. tostring(err))
	end
	if used ~= #queue then
		table.insert(problems, string.format("random draws: web sim %d, port %d", #queue, used))
	end
	if e.S then
		compare(e.S, sim.S, "S", problems)
	end
	if firstExact and firstExact ~= "shown" then
		print(string.format("first exact difference at line %d (%s), tick %d: %s", lineNo, e.op, ticks, firstExact))
		firstExact = "shown"
	end
	if #problems > 0 then
		print(string.format("DIVERGED at line %d (%s), tick %d, t = %.2f s", lineNo, e.op, ticks, sim and sim.S.t or 0))
		if e.op == "act" then
			print("action " .. serde.encode("json", e.a) .. " by " .. e.id)
		end
		for _, p in problems do
			print("  " .. p)
		end
		process.exit(1)
	end
end
print(
	string.format("MATCH: %d ticks and %d actions, night ended '%s' at t = %.1f s", ticks, acts, sim.S.phase, sim.S.t)
)
