// Seed data loaded into the database on first run only.
// Everything here is editable afterwards from the admin panel; this file is
// never read again once the database exists.
//
// PRICES ARE INDICATIVE PLACEHOLDERS (labour only, ₹, excl. GST) set for a
// Tier-2 premium workshop. Review every figure in Admin → Rate card before
// going live. `null` means "On quote".

export const BIKE_CLASSES = {
  A: { label: 'Class A', name: '450-700cc', blurb: 'Singles and parallel twins', image: '/img/bikes/himalayan-450.jpg', image_alt: 'Royal Enfield Himalayan 450' },
  B: { label: 'Class B', name: 'Middleweight', blurb: '700-1000cc twins, triples and 600 supersports', image: '/img/bikes/z900.jpg', image_alt: 'Kawasaki Z900' },
  C: { label: 'Class C', name: 'Superbike', blurb: 'Litre-class, V4s and big ADV', image: '/img/bikes/zx-10r.jpg', image_alt: 'Kawasaki Ninja ZX-10R' },
};

export const CATEGORIES = [
  { id: 'periodic', name: 'Periodic & major service', summary: 'Scheduled maintenance at the manufacturer interval, checked rather than assumed.' },
  { id: 'engine', name: 'Valves, engine & clutch', summary: 'Valve clearance, shim work, top-end and full rebuilds.' },
  { id: 'suspension', name: 'Suspension', summary: 'Fork and shock servicing, seals, oil weights and set-up for your weight.' },
  { id: 'brakes', name: 'Brakes, chain & tyres', summary: 'Fluid, pads, braided lines, final drive and wheels.' },
  { id: 'performance', name: 'Performance & tuning', summary: 'ECU remaps through partner tuners, intake, exhaust and throttle body work.' },
  { id: 'protection', name: 'Protection & accessories', summary: 'Frame and crash sliders, spools, grips and bolt-on accessories, fitted to torque spec.' },
  { id: 'electrical', name: 'Diagnostics & electrical', summary: 'Find the fault first. Charging systems, wiring and accessory installs.' },
  { id: 'care', name: 'Inspections & detailing', summary: 'Pre-ride checks, pre-purchase inspections, wash, detail and coating.' },
  { id: 'labour', name: 'Labour & logistics', summary: 'Hourly work, pick-up and drop.' },
];

const c = (id, category, name, summary, prices, extra = {}) => ({
  id, category, name, summary,
  prices: { A: prices[0], B: prices[1], C: prices[2] },
  includes: extra.includes || [],
  hours: extra.hours || '',
  sac: extra.sac || '998714',
  from: extra.from ?? false,
  public: extra.public ?? true,
});

export const CATALOG = [
  // Periodic
  c('general-service', 'periodic', 'General service', 'Oil and filter change with a full safety and wear inspection.', [1800, 3000, 4500], {
    hours: '2-4 h',
    includes: ['Engine oil & filter change', 'Air filter clean / check', 'Chain clean, lube & adjust', 'Brake pad & fluid level check', 'Cable & lever lube', 'Fastener torque check', 'Test ride & report'],
  }),
  c('major-service', 'periodic', 'Major service', 'Full interval service including valve clearance check, plugs, fluids and throttle body sync where applicable.', [6500, 11000, 16500], {
    hours: '1-2 days', from: true,
    includes: ['Everything in General service', 'Valve clearance inspection', 'Spark plugs replaced', 'Coolant & brake fluid flush', 'Throttle body sync (multi-cylinder)', 'Bearings, linkage & steering head check'],
  }),
  c('desmo-service', 'periodic', 'Ducati Desmo service', 'Desmodromic valve inspection and adjustment with timing belt replacement where due.', [null, 16000, 26000], {
    hours: '2-3 days', from: true,
    includes: ['Opening & closing shim check', 'Timing belts (where fitted)', 'Plugs, fluids & filters', 'Throttle body sync'],
  }),
  c('oil-change', 'periodic', 'Oil & filter change', 'Drain, replace filter and refill to spec. Oil and filter billed as parts.', [600, 900, 1200], { hours: '45 min' }),

  // Engine
  c('valve-check', 'engine', 'Valve clearance inspection', 'Measure every valve against the factory spec and give you the readings.', [2500, 5000, 8000], { hours: '3-6 h', includes: ['Tank, airbox & cover removal', 'Feeler-gauge measurement', 'Written readings per valve'] }),
  c('shim-adjust', 'engine', 'Shim adjustment', 'Cam removal and shim replacement for valves out of spec. Shims billed as parts.', [3500, 7500, 12000], { hours: '1-2 days', from: true, includes: ['Cam removal & timing', 'Shim measurement & swap', 'Re-check to spec', 'New cover gasket fitted'] }),
  c('cam-chain', 'engine', 'Cam chain & tensioner', 'Replace cam chain, guides or tensioner.', [4000, 7000, 11000], { from: true }),
  c('clutch-plates', 'engine', 'Clutch plate replacement', 'Friction and steel plates, springs inspected.', [2000, 3000, 4500], { hours: '3-5 h' }),
  c('top-end', 'engine', 'Engine top-end overhaul', 'Head off, valves lapped, seals replaced, rings and bore inspected.', [18000, 30000, 45000], { from: true, hours: '4-7 days' }),
  c('engine-rebuild', 'engine', 'Full engine rebuild', 'Complete strip, measure, rebuild to spec. Quoted after teardown.', [null, null, null], { hours: 'On inspection' }),

  // Suspension
  c('fork-service', 'suspension', 'Fork oil & seal service', 'Both legs: oil, seals, dust wipers, bushings inspected.', [3500, 5000, 7500], { hours: '4-6 h', includes: ['Fork removal & strip', 'New oil to spec weight & level', 'Oil seals & dust seals', 'Bushing inspection'] }),
  c('fork-rebuild', 'suspension', 'Cartridge fork rebuild', 'Full cartridge strip, bushings, re-valve on request.', [6500, 9000, 13000], { from: true }),
  c('shock-service', 'suspension', 'Rear shock service', 'Oil, seals and nitrogen recharge.', [3500, 4500, 6500], { from: true }),
  c('sag-setup', 'suspension', 'Sag & clicker set-up', 'Static and rider sag measured and set for your weight and riding.', [1500, 1500, 2000], { hours: '1 h' }),
  c('linkage', 'suspension', 'Linkage & swingarm bearings', 'Clean, grease or replace linkage and pivot bearings.', [2000, 3000, 4000]),

  // Brakes / chain / tyres
  c('brake-flush', 'brakes', 'Brake fluid flush', 'Front and rear, DOT 4 or DOT 5.1, bled until clear.', [900, 1200, 1500], { hours: '1 h' }),
  c('clutch-flush', 'brakes', 'Hydraulic clutch flush', 'Fresh fluid for hydraulic clutch systems.', [600, 700, 800]),
  c('brake-pads', 'brakes', 'Brake pad replacement', 'Per axle. Calipers cleaned, pistons inspected.', [600, 800, 1000]),
  c('caliper-rebuild', 'brakes', 'Caliper rebuild', 'Per caliper: strip, new seals, pistons cleaned.', [1500, 2000, 2500]),
  c('braided-lines', 'brakes', 'Braided brake line install', 'Steel braided lines fitted and bled. Lines billed as parts.', [1500, 2000, 2500]),
  c('chain-sprocket', 'brakes', 'Chain & sprocket replacement', 'Kit fitted, aligned and tensioned.', [1200, 1500, 2000]),
  c('chain-lube', 'brakes', 'Chain clean & lube', 'Deep clean, lube and slack adjustment.', [300, 400, 500]),
  c('tyre-change', 'brakes', 'Tyre change (per wheel)', 'Wheel off, tyre mounted and balanced.', [600, 750, 1000]),

  // Performance & tuning
  c('ecu-remap', 'performance', 'ECU remap (partner tuner)', 'We remove the ECU, send it to a reputed Indian tuning partner for a custom map for your exhaust and intake, then refit and test. Tuner fee quoted per bike.', [null, null, null], {
    hours: '5-10 days', includes: ['ECU removal & secure shipping', 'Custom map by partner tuner', 'Refit, adaptation & test ride', 'Stock map backup kept'],
  }),
  c('throttle-body-clean', 'performance', 'Throttle body cleaning', 'Carbon and varnish removed, idle relearn performed.', [1200, 2000, 3000], { hours: '1-3 h', includes: ['Airbox removal', 'Throttle body & butterfly clean', 'Idle / TPS reset', 'Test ride'] }),
  c('tb-sync', 'performance', 'Throttle body sync', 'Vacuum balance on multi-cylinder engines for smooth low-rpm fuelling.', [1200, 1800, 2500]),
  c('exhaust-install', 'performance', 'Exhaust installation', 'Slip-on or full system fitted, heat-shielded and leak-checked.', [1500, 2000, 3000], { from: true }),
  c('air-filter-upgrade', 'performance', 'Performance air filter install', 'Washable high-flow filter fitted. Filter billed as part.', [500, 800, 1200]),
  c('quickshifter', 'performance', 'Quickshifter / accessory install', 'Plug-and-play performance accessories fitted and calibrated.', [1500, 2000, 2500], { from: true }),

  // Protection & accessories
  c('frame-sliders', 'protection', 'Frame / crash slider install', 'Frame, fork, swingarm or engine-case sliders fitted with correct bolts and threadlocker, torqued to spec.', [800, 1000, 1500], { from: true, hours: '1-2 h' }),
  c('crash-protection', 'protection', 'Crash bars & engine guards', 'ADV crash bars, skid plates and radiator guards fitted.', [1200, 1500, 2000], { from: true }),
  c('spools', 'protection', 'Paddock stand spools', 'Swingarm spools fitted and torqued.', [300, 300, 400]),
  c('grips', 'protection', 'Handle grips & bar ends', 'Old grips removed cleanly, new grips bonded, bar-end weights refitted.', [500, 600, 700]),
  c('levers', 'protection', 'Levers, mirrors & controls', 'Adjustable levers, bar-end mirrors, rear-sets.', [500, 800, 1200], { from: true }),
  c('luggage', 'protection', 'Luggage & mounting systems', 'Racks, side-case mounts, tank-ring systems.', [1000, 1500, 2000], { from: true }),

  // Electrical
  c('diagnostics', 'electrical', 'Diagnostic scan & fault trace', 'OBD scan plus physical tracing to find the actual cause before anything is replaced.', [1000, 1500, 2000], { hours: '1-2 h' }),
  c('charging-test', 'electrical', 'Battery & charging system test', 'Battery, stator and regulator-rectifier tested under load.', [500, 500, 700]),
  c('wiring-repair', 'electrical', 'Wiring repair', 'Soldered and heat-shrunk, never spliced. Per hour.', [800, 1000, 1200]),
  c('aux-lights', 'electrical', 'Auxiliary light install', 'Relay-switched with its own fuse, routed cleanly.', [1500, 1800, 2200], { from: true }),

  // Care
  c('pre-ride', 'care', 'Pre-ride inspection', 'Full check before a long tour: tyres, brakes, fluids, chain and electrics.', [999, 1499, 1999], { hours: '1 h' }),
  c('ppi', 'care', 'Pre-purchase inspection', 'Buying a used superbike? We inspect it, scan it and tell you what it needs.', [1500, 2500, 3500], { hours: '2 h' }),
  c('foam-wash', 'care', 'Foam wash', 'Safe hand wash, chain degrease and dry.', [500, 700, 900]),
  c('detail', 'care', 'Full detail', 'Deep clean, polish and protect. Paint, metal and plastics.', [3000, 4000, 5000]),
  c('ceramic', 'care', 'Ceramic coating', 'Paint correction and multi-layer ceramic coat.', [12000, 15000, 18000], { from: true }),

  // Labour
  c('labour-hour', 'labour', 'Workshop labour (per hour)', 'For work not covered by a fixed job above.', [800, 1000, 1200], { public: true }),
  c('pickup-drop', 'labour', 'Pick-up & drop (Ratlam)', 'Within city limits. Flatbed from Indore / Ujjain on quote.', [500, 500, 500]),
];

// Quick-add parts for the invoice editor. HSN codes and GST rates are
// defaults: CONFIRM WITH YOUR CA before issuing tax invoices.
export const PART_PRESETS = [
  { name: 'Engine oil (per litre)', hsn: '2710', gst: 18, unit: 'L' },
  { name: 'Oil filter', hsn: '8421', gst: 18, unit: 'pc' },
  { name: 'Air filter', hsn: '8421', gst: 18, unit: 'pc' },
  { name: 'Performance air filter', hsn: '8421', gst: 18, unit: 'pc' },
  { name: 'Spark plug', hsn: '8511', gst: 18, unit: 'pc' },
  { name: 'Valve shim', hsn: '8714', gst: 18, unit: 'pc' },
  { name: 'Valve cover gasket', hsn: '8484', gst: 18, unit: 'pc' },
  { name: 'Brake pads (set)', hsn: '8714', gst: 18, unit: 'set' },
  { name: 'Braided brake line', hsn: '8714', gst: 18, unit: 'pc' },
  { name: 'Brake fluid (DOT 4 / 5.1)', hsn: '3819', gst: 18, unit: 'btl' },
  { name: 'Coolant (per litre)', hsn: '3820', gst: 18, unit: 'L' },
  { name: 'Fork oil (per litre)', hsn: '2710', gst: 18, unit: 'L' },
  { name: 'Fork oil seal kit', hsn: '8714', gst: 18, unit: 'set' },
  { name: 'Chain & sprocket kit', hsn: '8714', gst: 18, unit: 'kit' },
  { name: 'Chain lube / cleaner', hsn: '3403', gst: 18, unit: 'can' },
  { name: 'Throttle body cleaner', hsn: '3402', gst: 18, unit: 'can' },
  { name: 'Clutch plate kit', hsn: '8714', gst: 18, unit: 'kit' },
  { name: 'Frame / crash sliders', hsn: '8714', gst: 18, unit: 'set' },
  { name: 'Paddock stand spools', hsn: '8714', gst: 18, unit: 'pair' },
  { name: 'Handle grips', hsn: '8714', gst: 18, unit: 'pair' },
  { name: 'Battery', hsn: '8507', gst: 18, unit: 'pc' },
  { name: 'Exhaust system', hsn: '8714', gst: 18, unit: 'pc' },
  { name: 'Consumables & shop supplies', hsn: '', gst: 18, unit: 'lot' },
];

// Reference models → class. Fully editable in Admin → Bikes.
export const BIKE_MODELS = [
  // Class A
  ['Royal Enfield', 'Himalayan 450', 'A'], ['Royal Enfield', 'Guerrilla 450', 'A'], ['Royal Enfield', 'Interceptor 650', 'A'],
  ['Royal Enfield', 'Continental GT 650', 'A'], ['Royal Enfield', 'Super Meteor 650', 'A'], ['Royal Enfield', 'Shotgun 650', 'A'],
  ['Royal Enfield', 'Bear 650', 'A'], ['Royal Enfield', 'Classic 650', 'A'],
  ['Kawasaki', 'Ninja 500', 'A'], ['Kawasaki', 'Ninja 650', 'A'], ['Kawasaki', 'Z650', 'A'], ['Kawasaki', 'Z650RS', 'A'], ['Kawasaki', 'Versys 650', 'A'], ['Kawasaki', 'Eliminator 500', 'A'],
  ['Honda', 'NX500', 'A'], ['Honda', 'CB650R', 'A'], ['Honda', 'CBR650R', 'A'],
  ['BMW', 'F 450 GS', 'A'], ['Triumph', 'Trident 660', 'A'], ['Triumph', 'Tiger Sport 660', 'A'], ['Triumph', 'Daytona 660', 'A'],
  ['Aprilia', 'RS 457', 'A'], ['Aprilia', 'RS 660', 'A'], ['Aprilia', 'Tuono 660', 'A'],
  ['Benelli', 'TRK 502', 'A'], ['Benelli', '502C', 'A'], ['CFMoto', '650NK', 'A'], ['CFMoto', '650MT', 'A'],
  // Class B
  ['Kawasaki', 'Z900', 'B'], ['Kawasaki', 'Z900RS', 'B'], ['Kawasaki', 'Ninja ZX-6R', 'B'],
  ['Triumph', 'Street Triple 765', 'B'], ['Triumph', 'Tiger 900', 'B'], ['Triumph', 'Bonneville T120', 'B'],
  ['KTM', '890 Duke R', 'B'], ['KTM', '890 Adventure', 'B'],
  ['Honda', 'XL750 Transalp', 'B'], ['Suzuki', 'V-Strom 800DE', 'B'], ['Suzuki', 'GSX-8R', 'B'], ['Suzuki', 'GSX-8S', 'B'],
  ['Yamaha', 'MT-09', 'B'], ['BMW', 'F 900 R', 'B'], ['BMW', 'F 900 GS', 'B'],
  ['Ducati', 'Monster', 'B'], ['Ducati', 'Scrambler 800', 'B'], ['Ducati', 'Hypermotard 950', 'B'], ['Ducati', 'Multistrada V2', 'B'],
  ['Harley-Davidson', 'Nightster 975', 'B'],
  // Class C
  ['Kawasaki', 'Ninja ZX-10R', 'C'], ['Kawasaki', 'Z H2', 'C'], ['Kawasaki', 'Ninja 1100SX', 'C'], ['Kawasaki', 'Versys 1100', 'C'],
  ['BMW', 'S 1000 RR', 'C'], ['BMW', 'M 1000 RR', 'C'], ['BMW', 'R 1300 GS', 'C'],
  ['Ducati', 'Panigale V4', 'C'], ['Ducati', 'Streetfighter V4', 'C'], ['Ducati', 'Multistrada V4', 'C'], ['Ducati', 'Diavel V4', 'C'],
  ['Suzuki', 'Hayabusa', 'C'], ['Honda', 'CBR1000RR-R Fireblade', 'C'], ['Honda', 'Africa Twin', 'C'],
  ['Yamaha', 'YZF-R1', 'C'], ['Triumph', 'Speed Triple 1200 RS', 'C'], ['Triumph', 'Tiger 1200', 'C'], ['Triumph', 'Rocket 3', 'C'],
  ['Aprilia', 'RSV4', 'C'], ['Aprilia', 'Tuono V4', 'C'], ['KTM', '1390 Super Duke R', 'C'],
  ['Harley-Davidson', 'Pan America 1250', 'C'], ['Harley-Davidson', 'Fat Boy 114', 'C'],
];

// Parts brands shown in "Brands we fit". Brands named by the
// owner are published by default; switch others on in Admin → Brands once
// you actually stock them. Upload the official logo file for each.
export const PART_BRANDS = [
  ['Motul', 'Oils & lubricants', 1], ['Motorex', 'Oils & bike care', 1], ['K&N', 'Performance air filters', 1],
  ['Crank1', 'Brake pads', 1], ['HEL Performance', 'Braided brake lines', 1],
  ['Liqui Moly', 'Oils & additives', 1], ['Brembo', 'Brakes', 1], ['Evotech Performance', 'Frame sliders & protection', 1],
  ['SW-Motech', 'Crash bars & luggage', 1], ['RCB', 'Grips, levers & spools', 1],
  ['NGK', 'Spark plugs', 0], ['D.I.D', 'Chains', 0], ['EBC Brakes', 'Brake pads & discs', 0], ['Akrapovič', 'Exhaust systems', 0], ['SC-Project', 'Exhaust systems', 0],
  ['Pirelli', 'Tyres', 0],
];

export const DEFAULT_SETTINGS = {
  name: 'Torque Nation',
  legal_name: 'Torque Nation',
  tagline: 'Torqued to spec.',
  phone: '+91 00000 00000',
  whatsapp: '910000000000',
  email: 'hello@torquenation.in',
  address_line1: 'Workshop address',
  address_line2: '',
  city: 'Ratlam',
  state: 'Madhya Pradesh',
  state_code: '23',
  pincode: '457001',
  maps_url: '',
  hours: 'Mon-Sat, 10:00 to 19:30',
  opening_hours_schema: 'Mo-Sa 10:00-19:30',
  site_url: '',
  hero_image: '/img/bikes/panigale-v4.jpg',
  hero_image_alt: 'Ducati Panigale V4 Superleggera, side profile',
  geo_lat: '',
  geo_lng: '',
  instagram: '',
  google_reviews_url: '',
  gst_enabled: true,
  gstin: '',
  invoice_prefix: 'TN',
  estimate_prefix: 'TN-EST',
  bank_name: '',
  bank_account: '',
  bank_ifsc: '',
  upi_id: '',
  invoice_terms: 'Parts once fitted are not returnable. Warranty on parts as per manufacturer. Workmanship warranty: 30 days / 1,000 km on the job performed. Vehicles not collected within 7 days of completion may attract storage charges.',
};
