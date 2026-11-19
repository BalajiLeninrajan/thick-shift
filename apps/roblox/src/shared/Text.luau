--!strict
-- Words the client shows, from task.js, player.js, hud.js and ui.js.

local Text = {}

Text.FAULT_NAME = { "Reset the breaker", "Reconnect the wires", "Bleed the valve" } -- by fault kind + 1
Text.DOOR_NAME = { L = "left door", R = "right door", V = "vent" }
-- What each mascot did to you, by MASC index + 1.
Text.HOW = { "sat on you", "hugged you a bit too hard", "landed on you", "did not slow down" }

Text.RULES = {
	"The job. Faults keep breaking out in the breaker boxes around the building. Each one leaks power, more the longer it is left, and after a while puts its room's lights out; left too long it burns out the wiring, and the building holds less charge for the rest of the night.",
	"Power. Doors, lights and the torch charger run on it. Hold E at the generator crank in the booth to put some back. At zero every door opens and the lights go out.",
	"Your torch. The beam holds a mascot back while it is on it. A full battery lasts about a minute: charge it at the dock in the booth, or pick up spare batteries.",
	"The mascots. They stand still, then wander in waves. Touch one and you are flat until a friend stands over you and holds E. While flat, Q calls for help and Space watches a friend. Everyone flat at once ends the night.",
	"Lockers. Hold E at a locker out on the floor to step inside and out of sight. One that sees you get in opens the door, one that has lost you checks the lockers nearby, and one that stands outside too long sniffs you out.",
	"The booth is where you start: the generator, the charger, a wall map of the faults, and three doors you can shut. Shut doors drain power fast and faults do not fix themselves, so it is no place to hide.",
	"Controls. W A S D walk, the mouse looks, Shift runs, F is the torch, E uses things.",
}

return Text
