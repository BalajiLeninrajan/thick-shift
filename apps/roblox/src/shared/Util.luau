--!strict
-- Small numeric helpers that keep the port's arithmetic the same as the web game's.

local Util = {}

-- hypot in map.ts: the plain formula on both sides, so the two round alike.
function Util.hypot(x: number, z: number): number
	return math.sqrt(x * x + z * z)
end

-- JS `x | 0` for the values the game uses it on: truncation toward zero.
function Util.trunc(x: number): number
	return if x >= 0 then math.floor(x) else math.ceil(x)
end

-- The signed difference a - b folded into [-pi, pi]. JS % keeps the dividend's sign, so this is fmod, not Luau's %.
function Util.angDiff(a: number, b: number): number
	local d = math.fmod(a - b, math.pi * 2)
	if d > math.pi then
		d -= math.pi * 2
	end
	if d < -math.pi then
		d += math.pi * 2
	end
	return d
end

function Util.clamp(v: number, lo: number, hi: number): number
	return math.max(lo, math.min(hi, v))
end

function Util.isFinite(v: any): boolean
	return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge
end

function Util.dist(a: { x: number, z: number }, b: { x: number, z: number }): number
	return Util.hypot(a.x - b.x, a.z - b.z)
end

-- Arrays of plain values and tables.
function Util.filter<T>(list: { T }, f: (T) -> boolean): { T }
	local out = {}
	for _, v in list do
		if f(v) then
			table.insert(out, v)
		end
	end
	return out
end

function Util.some<T>(list: { T }, f: (T) -> boolean): boolean
	for _, v in list do
		if f(v) then
			return true
		end
	end
	return false
end

function Util.find<T>(list: { T }, f: (T) -> boolean): T?
	for _, v in list do
		if f(v) then
			return v
		end
	end
	return nil
end

function Util.count<T>(list: { T }, f: (T) -> boolean): number
	local n = 0
	for _, v in list do
		if f(v) then
			n += 1
		end
	end
	return n
end

function Util.includes<T>(list: { T }, x: T): boolean
	return table.find(list, x) ~= nil
end

-- A seeded random source that returns the same numbers as seeded() in packages/sim/src/random.ts,
-- for the differential test. The game itself uses Random.new().
local U32 = 4294967296
local function imul(a: number, b: number): number
	-- The low 32 bits of a * b, without the product passing 2^53.
	local ah, al = math.floor(a / 65536), a % 65536
	return (al * b + ((ah * b) % 65536) * 65536) % U32
end
function Util.seeded(seed: number): () -> number
	local a = (seed * 2654435761) % U32
	return function()
		a = (a + 0x6D2B79F5) % U32
		local t = imul(bit32.bxor(a, bit32.rshift(a, 15)), bit32.bor(1, a))
		t = bit32.bxor((t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(61, t))) % U32, t)
		return bit32.bxor(t, bit32.rshift(t, 14)) / U32
	end
end

return Util
