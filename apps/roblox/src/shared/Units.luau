--!strict
-- The game thinks in metres with x east, z south and y up, and yaw 0 facing south (+z). Roblox has the same axes
-- (right-handed, y up), so a point only needs scaling. A Roblox CFrame looks down its -Z, so facing a yaw is a turn
-- of yaw + pi about y.

local Units = {}

Units.SC = 3 -- studs per metre

function Units.v3(x: number, y: number, z: number): Vector3
	return Vector3.new(x * Units.SC, y * Units.SC, z * Units.SC)
end

-- A size scales as a point does. The two names say which the vector is.
Units.size = Units.v3

-- A frame at a point, facing a yaw (radians, 0 = south).
function Units.cf(x: number, y: number, z: number, yaw: number?): CFrame
	return CFrame.new(x * Units.SC, y * Units.SC, z * Units.SC) * CFrame.Angles(0, (yaw or 0) + math.pi, 0)
end

-- The same, looking up or down by pitch (positive looks up).
function Units.eye(x: number, y: number, z: number, yaw: number, pitch: number): CFrame
	return Units.cf(x, y, z, yaw) * CFrame.Angles(pitch, 0, 0)
end

function Units.rgb(t: { number }): Color3
	return Color3.new(t[1], t[2], t[3])
end

return Units
