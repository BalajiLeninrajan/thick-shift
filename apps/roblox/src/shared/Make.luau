--!nonstrict
-- Builders the client modules share: an instance with its properties set, a part that only gets looked at, and a
-- guard's torch.

local Shared = game:GetService("ReplicatedStorage"):WaitForChild("Shared")
local Units = require(Shared.Units)

local Make = {}

-- An instance of class with props set, then parented.
function Make.new(class: string, props, parent)
	local o = Instance.new(class)
	for k, v in props do
		o[k] = v
	end
	o.Parent = parent
	return o
end

-- A smooth part that stays where it is put and that nothing collides with, touches or raycasts against.
function Make.part(props, parent): Part
	local p = Instance.new("Part")
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.TopSurface, p.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in props do
		p[k] = v
	end
	p.Parent = parent
	return p
end

-- A guard's torch: an invisible part to aim, and the beam out of its front. It is off until its Brightness is set.
function Make.torch(parent): (Part, SpotLight)
	local holder = Make.part({ Name = "Torch", Transparency = 1, Size = Vector3.one * 0.2 }, parent)
	local beam = Make.new("SpotLight", {
		Color = Color3.fromRGB(255, 240, 208),
		Angle = 60,
		Range = math.min(60, 22 * Units.SC),
		Shadows = true,
		Brightness = 0,
		Face = Enum.NormalId.Front,
	}, holder)
	return holder, beam
end

return Make
