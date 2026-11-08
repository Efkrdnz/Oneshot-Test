// Material and liquid presets. Densities are real-world values in kg/m^3.
// Friction values are typical dry-contact coefficients (static, kinetic).

export const MATERIALS = {
  wood:     { name: 'Wood',      density: 700,   staticFriction: 0.5,  friction: 0.4,  restitution: 0.35, color: '#c08a52' },
  steel:    { name: 'Steel',     density: 7850,  staticFriction: 0.6,  friction: 0.42, restitution: 0.55, color: '#9fb0c4' },
  aluminum: { name: 'Aluminium', density: 2700,  staticFriction: 0.6,  friction: 0.47, restitution: 0.5,  color: '#c9d3de' },
  lead:     { name: 'Lead',      density: 11340, staticFriction: 0.7,  friction: 0.55, restitution: 0.08, color: '#6d7787' },
  gold:     { name: 'Gold',      density: 19300, staticFriction: 0.5,  friction: 0.4,  restitution: 0.3,  color: '#e9b949' },
  rubber:   { name: 'Rubber',    density: 1100,  staticFriction: 1.0,  friction: 0.8,  restitution: 0.82, color: '#e05d5d' },
  ice:      { name: 'Ice',       density: 917,   staticFriction: 0.05, friction: 0.03, restitution: 0.12, color: '#a8e6ff' },
  glass:    { name: 'Glass',     density: 2500,  staticFriction: 0.9,  friction: 0.4,  restitution: 0.6,  color: '#7dd3c8' },
  stone:    { name: 'Stone',     density: 2600,  staticFriction: 0.7,  friction: 0.6,  restitution: 0.2,  color: '#8b8f98' },
  concrete: { name: 'Concrete',  density: 2400,  staticFriction: 0.9,  friction: 0.7,  restitution: 0.15, color: '#6b7280' },
  plastic:  { name: 'Plastic',   density: 950,   staticFriction: 0.35, friction: 0.3,  restitution: 0.55, color: '#5b8def' },
  cork:     { name: 'Cork',      density: 240,   staticFriction: 0.6,  friction: 0.5,  restitution: 0.4,  color: '#b9875d' },
  foam:     { name: 'Foam',      density: 30,    staticFriction: 0.8,  friction: 0.7,  restitution: 0.2,  color: '#f3c4fb' },
  balsa:    { name: 'Balsa',     density: 160,   staticFriction: 0.5,  friction: 0.4,  restitution: 0.3,  color: '#e8c98f' },
  teflon:   { name: 'Teflon',    density: 2200,  staticFriction: 0.04, friction: 0.04, restitution: 0.3,  color: '#e5e7eb' },
  superball:{ name: 'Superball', density: 1200,  staticFriction: 0.9,  friction: 0.8,  restitution: 0.95, color: '#a3e635' },
  frictionless: { name: 'Frictionless', density: 1000, staticFriction: 0, friction: 0, restitution: 0.0, color: '#94a3b8' },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);

export function materialFrom(key) {
  const m = MATERIALS[key] || MATERIALS.wood;
  return {
    key: MATERIALS[key] ? key : 'wood',
    density: m.density,
    staticFriction: m.staticFriction,
    friction: m.friction,
    restitution: m.restitution,
  };
}

// Liquids: density kg/m^3, dynamic viscosity Pa*s (used for viscous drag),
// and parameters for the particle fluid solver.
export const LIQUIDS = {
  water:    { name: 'Water',       density: 1000,  viscosity: 0.001, color: '#2f8fff', particleVisc: 0.05 },
  saltwater:{ name: 'Salt water',  density: 1200,  viscosity: 0.0012, color: '#2ec6d6', particleVisc: 0.06 },
  oil:      { name: 'Olive oil',   density: 910,   viscosity: 0.08,  color: '#e9c46a', particleVisc: 0.35 },
  honey:    { name: 'Honey',       density: 1420,  viscosity: 6.0,   color: '#f4a226', particleVisc: 2.5 },
  mercury:  { name: 'Mercury',     density: 13534, viscosity: 0.0015, color: '#c7ced8', particleVisc: 0.04 },
  alcohol:  { name: 'Ethanol',     density: 789,   viscosity: 0.0011, color: '#b9a7ff', particleVisc: 0.04 },
  slime:    { name: 'Slime',       density: 1050,  viscosity: 1.5,   color: '#6ee065', particleVisc: 1.6 },
  lava:     { name: 'Lava',        density: 2600,  viscosity: 100,   color: '#ff5a1f', particleVisc: 3.5 },
};

export const LIQUID_KEYS = Object.keys(LIQUIDS);

export const PLANETS = {
  earth:   { name: 'Earth',   g: 9.81,  air: 1.225 },
  moon:    { name: 'Moon',    g: 1.62,  air: 0 },
  mars:    { name: 'Mars',    g: 3.71,  air: 0.02 },
  venus:   { name: 'Venus',   g: 8.87,  air: 65 },
  jupiter: { name: 'Jupiter', g: 24.79, air: 0.16 },
  titan:   { name: 'Titan',   g: 1.35,  air: 5.3 },
  sun:     { name: 'Sun (surface)', g: 274, air: 0 },
  zero:    { name: 'Zero-G',  g: 0,     air: 0 },
};

export const AIR_PRESETS = {
  vacuum: { name: 'Vacuum', density: 0, viscosity: 0 },
  air:    { name: 'Air (sea level)', density: 1.225, viscosity: 1.8e-5 },
  thin:   { name: 'High altitude', density: 0.41, viscosity: 1.4e-5 },
  thick:  { name: 'Dense gas (CO2 x10)', density: 18, viscosity: 1.5e-5 },
  water:  { name: 'Underwater', density: 1000, viscosity: 0.001 },
  syrup:  { name: 'Syrup', density: 1350, viscosity: 2.5 },
};

// Simple palette used for objects that do not use a material color.
export const PALETTE = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#60a5fa', '#e879f9'];
