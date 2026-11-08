# PhysLab — an interactive 2D physics laboratory

PhysLab is a browser-based physics lab where you build scenarios, change the
rules of the room and measure what happens. Everything runs client-side in
plain JavaScript (no build step, no dependencies), on a physics engine written
for this project.

**Play it:** once GitHub Pages is enabled for this repository (see
[Deployment](#deployment)), the lab is served at
`https://<owner>.github.io/Oneshot-Test/`. You can also open `index.html`
through any static web server (see [Run locally](#run-locally)).

## What you can do

**Build scenarios**
- Boxes, balls, regular polygons, wedges, freehand (even concave) shapes,
  cups, sealed tanks and boat hulls in 17 materials (wood, steel, rubber,
  ice, glass, foam, lead, gold, Teflon, a frictionless material…), each with
  real density, static and kinetic friction, and restitution.
- Static platforms, slopes drawn at any angle, smooth hand-drawn tracks
  (ramps, half-pipes, curves), conveyor belts and kinematic moving platforms.
- Connectors: pins and hinges (with angle limits), motors, welds, strings
  that can go slack, rigid rods, Hooke's-law springs, elastic bands,
  collidable chains, pulleys (Atwood machines) and rails (air tracks).
  Connectors can be given a break force and cut with the scissors while the
  simulation runs.

**Change the rules of the room**
- Gravity strength and direction, with planet presets (Earth, Moon, Mars,
  Jupiter, zero-g…).
- Air density and viscosity (vacuum, sea-level air, underwater, syrup…), wind,
  and fan / wind zones. Drag is `½ρC_dAv² + 3πμwv` using each body's
  projected width.
- Room size and walls, wall material, friction and restitution mixing,
  solver step rate and sub-steps, sleeping, mutual gravity and electric
  charges.

**Liquids**
- Liquid pools with exact Archimedes buoyancy (each body is clipped against the
  free surface), viscous and quadratic liquid drag, wave-making damping and a
  dynamic surface that obeys the shallow-water wave equation. Pools can be
  layered (oil over water), and they have wave generators and absorbing
  beaches.
- Pourable particle liquid (water, oil, honey, mercury, lava…) that flows,
  splashes, fills cups, pushes bodies around and drains away. Faucets and
  drains included.
- Liquid *inside* objects: sealed tanks and boats can carry an internal liquid
  whose weight acts at its true centroid (its free surface stays level), so
  half-full containers rock and right themselves realistically.

**Waves**
- Wave strings with tension and linear density (`v = √(T/μ)`), sine, square or
  single-pulse drivers, and fixed, free or absorbing ends. They show standing
  waves, harmonics and reflections. You can pluck them with the grab tool.
- Surface waves in pools, plus coupled spring-mass oscillators.

**Measure**
- Photogates (light beams) that trigger on the leading edge or on the centre of
  mass. They start, stop, toggle, lap or reset chronometers, and record speed
  and beam-blocked time. Crossing instants are found by bisection inside each
  solver sub-step, giving sub-millisecond timing.
- Chronometers: manual, gate-driven, or auto-started at t = 0.
- Rulers with length and angle readouts, text notes, velocity and force vectors
  (gravity, normal, friction, drag, buoyancy), trails and strobe snapshots.
- Live graphs of position, velocity, acceleration, energy and momentum,
  system energy (kinetic, potential, elastic), and CSV export of everything,
  including gate and lap logs.

**Launch things**
- Cannons (aim, muzzle speed, projectile material and mass, an ideal-parabola
  preview, auto fire), slingshots with an elastic band (`v = s·√(k/m)`), a
  launch tool that sets velocity by dragging, a blast tool, and gravity wells
  for orbits.

**Experiment presets (24)**: free fall in vacuum vs. air, inclined planes and
friction, a brachistochrone race, projectile motion with drag, pendulums,
Newton's cradle, air-track collisions, springs and coupled oscillators,
buoyancy and density, Atwood machines, a slingshot vs. a tower, domino chains,
waves on strings, a wave tank with boats, pouring onto a seesaw, a viscosity
race, terminal velocity, orbits, conveyors and machines, an energy skate park,
a ballistic pendulum, levers and torque, and a wrecking-ball playground.

**Workflow**: undo and redo, reset-to-start, save slots in the browser,
JSON export and import, share links that encode the whole experiment in the
URL, duplicate, copy and paste, multi-select, grid snapping, keyboard
shortcuts, and right-click menus.

## Controls

| Action | How |
| --- | --- |
| Play / pause | `Space` |
| Step one frame | `.` |
| Reset to start state | `R` (Shift-click Reset to make the current state the start) |
| Undo / redo | `Ctrl Z` / `Ctrl Shift Z` |
| Duplicate / copy / paste | `Ctrl D` / `Ctrl C` / `Ctrl V` |
| Delete | `Del` |
| Zoom / pan | mouse wheel / middle-drag or `Space`+drag (pinch on touch) |
| Fit view | `0` |
| Grid snap | `Ctrl G` |
| Tools | `V` select, `G` grab, `H` pan, `L` launch, `X` blast, `K` scissors, `E` eraser, `B` box, `C` ball, `P` polygon, `W` wedge, `F` freehand, `U` container, `I` slope, `T` track, `J` pin, `M` motor, `Q` string, `S` spring, `O` pour, `D` photogate, `Y` chronometer, `N` ruler, `Z` cannon, `A` gravity well |

## Physics engine

- **Units:** SI throughout. A 2D body's mass is density × area × slab depth.
  The slab depth defaults to 0.1 m and can be changed under Room.
- **Rigid bodies:** convex polygons and circles combined into compound bodies.
  Concave outlines are triangulated and merged into convex pieces; internal
  seams are flagged so they never produce false collision normals.
- **Collision:** SAT with reference-face clipping and speculative contacts
  that prevent tunnelling. Ghost-vertex handling keeps rolling and sliding
  smooth across track seams: a frictionless bead on a faceted curve keeps
  99.6 % of its ideal speed.
- **Solver:** a fixed 120 Hz step with 4 sub-steps in a soft-step scheme
  (soft-constraint solve, integrate, rigid relax, then restitution), in the
  spirit of Box2D v3. A nonlinear Gauss-Seidel position pass removes leftover
  penetration. Friction has separate static and kinetic coefficients and
  supports conveyor surface velocities.
- **Joints:** revolute (motor, limits, weld), distance (rod, rope, explicit
  symplectic springs that fall back to implicit soft springs when stiff),
  pulley and prismatic, plus a soft mouse joint for dragging.
- **Islands and sleeping:** union-find islands put resting groups to sleep, and
  any contact with an awake body wakes them instantly.

### Validation

`npm test` runs headless checks of the engine against analytic results:

| Check | Result |
| --- | --- |
| Free fall over 4 m, timed by a photogate | 0.9030 s (theory 0.9030 s) |
| Block on a 30° slope with μk = 0.2 | a = 3.206 m/s² (theory 3.206) |
| Static friction at 20° with μs = 0.5 | holds |
| Pendulum period, L = 2 m | 2.836 s (theory 2.838 s) |
| Spring period, m = 2 kg, k = 50 N/m | 1.2569 s (theory 1.2566 s) |
| Atwood machine, 2 kg vs. 1 kg | 3.270 m/s² (theory g/3) |
| Projectile range at 40° and 10 m/s | 10.039 m (theory 10.039 m) |
| Slingshot launch speed | 30.00 m/s (theory s·√(k/m) = 30) |
| Wood floating in water | 70.0 % submerged |
| Terminal velocity, wave speed on a string, elastic collisions, 12-box stack stability, conveyors, motors, liquids, sleeping-body impacts | pass |

## Run locally

Browsers block ES modules on `file://`, so serve the folder:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Run the engine tests with Node 18+:

```bash
npm test
```

## Deployment

`.github/workflows/pages.yml` runs the physics tests and publishes the static
site to GitHub Pages on every push to `main` or `claude/**` branches, or when
started manually. If the repository has never used Pages, enable it once:
**Settings → Pages → Build and deployment → Source: GitHub Actions**, then
re-run the workflow.

## Project layout

```
index.html            app shell
css/style.css         dark lab theme
js/engine/            physics engine (no DOM): math, shapes, bodies, collision,
                      solver, joints, forces, pools, particle fluid,
                      instruments, devices, wave strings, world
js/lab/               scene (de)serialisation, builder API, experiment presets
js/ui/                renderer, camera, tools, inspector, panels, forms,
                      recorder, history, storage, app controller
tests/                headless physics validation
```

## License

MIT
