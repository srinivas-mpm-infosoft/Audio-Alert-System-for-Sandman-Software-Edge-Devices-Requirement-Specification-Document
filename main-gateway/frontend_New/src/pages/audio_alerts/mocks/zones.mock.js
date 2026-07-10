export const MOCK_PLANTS = [
  { id: "plant-1", name: "Plant-1", location: "Rajkot, Gujarat" },
  { id: "plant-2", name: "Plant-2", location: "Coimbatore, Tamil Nadu" },
  { id: "plant-3", name: "Plant-3", location: "Pune, Maharashtra" },
];

export const MOCK_LINES = [
  { id: "l1-1", plant_id: "plant-1", name: "Line-1" },
  { id: "l1-2", plant_id: "plant-1", name: "Line-2" },
  { id: "l2-1", plant_id: "plant-2", name: "Line-1" },
  { id: "l2-2", plant_id: "plant-2", name: "Line-2" },
  { id: "l2-3", plant_id: "plant-2", name: "Line-3" },
  { id: "l3-1", plant_id: "plant-3", name: "Line-1" },
  { id: "l3-2", plant_id: "plant-3", name: "Line-2" },
];

export const MOCK_ZONES = [
  { id: "z001", line_id: "l1-1", plant_id: "plant-1", name: "Melting-1", type: "Melting", default_language: "EN", fallback_language: "HI", morning_language: "EN", afternoon_language: "EN", night_language: "HI" },
  { id: "z002", line_id: "l1-1", plant_id: "plant-1", name: "Moulding-A", type: "Moulding", default_language: "EN", fallback_language: "HI", morning_language: "EN", afternoon_language: "EN", night_language: "HI" },
  { id: "z003", line_id: "l1-1", plant_id: "plant-1", name: "Mulling-1", type: "Mulling", default_language: "EN", fallback_language: "HI", morning_language: "EN", afternoon_language: "EN", night_language: "HI" },
  { id: "z004", line_id: "l1-1", plant_id: "plant-1", name: "Cooling-1", type: "Cooling", default_language: "EN", fallback_language: "HI", morning_language: "EN", afternoon_language: "EN", night_language: "HI" },
  { id: "z005", line_id: "l1-2", plant_id: "plant-1", name: "Sand Prep-1", type: "Sand Prep", default_language: "HI", fallback_language: "EN", morning_language: "HI", afternoon_language: "HI", night_language: "EN" },
  { id: "z006", line_id: "l1-2", plant_id: "plant-1", name: "Pouring-1", type: "Pouring", default_language: "HI", fallback_language: "EN", morning_language: "HI", afternoon_language: "HI", night_language: "EN" },
  { id: "z007", line_id: "l1-2", plant_id: "plant-1", name: "Moulding-B", type: "Moulding", default_language: "HI", fallback_language: "EN", morning_language: "HI", afternoon_language: "HI", night_language: "EN" },
  { id: "z008", line_id: "l2-1", plant_id: "plant-2", name: "Melting-2", type: "Melting", default_language: "TA", fallback_language: "EN", morning_language: "TA", afternoon_language: "TA", night_language: "EN" },
  { id: "z009", line_id: "l2-1", plant_id: "plant-2", name: "Moulding-C", type: "Moulding", default_language: "TA", fallback_language: "EN", morning_language: "TA", afternoon_language: "TA", night_language: "EN" },
  { id: "z010", line_id: "l2-1", plant_id: "plant-2", name: "Mulling-2", type: "Mulling", default_language: "TA", fallback_language: "EN", morning_language: "TA", afternoon_language: "TA", night_language: "EN" },
  { id: "z011", line_id: "l2-2", plant_id: "plant-2", name: "Cooling-2", type: "Cooling", default_language: "TA", fallback_language: "EN", morning_language: "TA", afternoon_language: "TA", night_language: "EN" },
  { id: "z012", line_id: "l2-2", plant_id: "plant-2", name: "Pouring-2", type: "Pouring", default_language: "TA", fallback_language: "EN", morning_language: "TA", afternoon_language: "TA", night_language: "EN" },
  { id: "z013", line_id: "l2-3", plant_id: "plant-2", name: "Sand Prep-2", type: "Sand Prep", default_language: "TA", fallback_language: "EN", morning_language: "TA", afternoon_language: "TA", night_language: "EN" },
  { id: "z014", line_id: "l3-1", plant_id: "plant-3", name: "Melting-3", type: "Melting", default_language: "MR", fallback_language: "EN", morning_language: "MR", afternoon_language: "MR", night_language: "EN" },
  { id: "z015", line_id: "l3-1", plant_id: "plant-3", name: "Moulding-D", type: "Moulding", default_language: "MR", fallback_language: "EN", morning_language: "MR", afternoon_language: "MR", night_language: "EN" },
  { id: "z016", line_id: "l3-2", plant_id: "plant-3", name: "Mulling-3", type: "Mulling", default_language: "MR", fallback_language: "EN", morning_language: "MR", afternoon_language: "MR", night_language: "EN" },
  { id: "z017", line_id: "l3-2", plant_id: "plant-3", name: "Cooling-3", type: "Cooling", default_language: "MR", fallback_language: "EN", morning_language: "MR", afternoon_language: "MR", night_language: "EN" },
];
