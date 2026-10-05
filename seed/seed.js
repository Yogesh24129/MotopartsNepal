require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

const products = [
  {
    name: "Front Disc Brake Pad Set",
    brand: "Bajaj Genuine",
    category: "Brakes",
    compatibleModels: ["Bajaj Pulsar 150", "Bajaj Pulsar 160"],
    price: 850,
    stock: 40,
    description: "OEM-grade sintered brake pads for confident stopping power in Kathmandu traffic and hill descents.",
  },
  {
    name: "Rear Drum Brake Shoe",
    brand: "Hero Genuine",
    category: "Brakes",
    compatibleModels: ["Hero Splendor Plus", "Hero HF Deluxe"],
    price: 450,
    stock: 55,
    description: "Durable rear brake shoe replacement, long-lasting for daily city commuting.",
  },
  {
    name: "MRF Nylogrip Tyre 90/90-18",
    brand: "MRF",
    category: "Tyres & Wheels",
    compatibleModels: ["Bajaj Pulsar 150", "TVS Apache RTR 160"],
    price: 3200,
    stock: 25,
    description: "All-weather grip tyre, well suited to Nepal's mixed tarmac and gravel roads.",
  },
  {
    name: "CEAT Zoom Tyre 100/90-17",
    brand: "CEAT",
    category: "Tyres & Wheels",
    compatibleModels: ["Yamaha FZ", "Honda CB Shine"],
    price: 3450,
    stock: 20,
    description: "Reinforced tread pattern for durability on hilly and off-road stretches.",
  },
  {
    name: "5W-40 Fully Synthetic Engine Oil (1L)",
    brand: "Motul",
    category: "Lubricants",
    compatibleModels: ["Universal — 4-stroke motorcycles"],
    price: 1450,
    stock: 60,
    description: "High-performance synthetic engine oil for smoother shifting and engine protection at altitude.",
  },
  {
    name: "20W-40 Semi-Synthetic Engine Oil (1L)",
    brand: "Castrol Power1",
    category: "Lubricants",
    compatibleModels: ["Universal — 4-stroke motorcycles"],
    price: 950,
    stock: 70,
    description: "Reliable everyday engine oil for commuter motorcycles.",
  },
  {
    name: "Chain & Sprocket Kit",
    brand: "Rato",
    category: "Engine Parts",
    compatibleModels: ["Bajaj Pulsar 150", "Bajaj Pulsar 180"],
    price: 2800,
    stock: 18,
    description: "Complete drive chain and sprocket set for smoother power transfer and reduced noise.",
  },
  {
    name: "Air Filter Element",
    brand: "TVS Genuine",
    category: "Engine Parts",
    compatibleModels: ["TVS Apache RTR 160", "TVS Sport"],
    price: 380,
    stock: 45,
    description: "OEM replacement air filter to keep dust out on unpaved roads.",
  },
  {
    name: "Spark Plug (Iridium)",
    brand: "NGK",
    category: "Engine Parts",
    compatibleModels: ["Universal — 4-stroke motorcycles"],
    price: 650,
    stock: 80,
    description: "Long-life iridium spark plug for better fuel efficiency and smoother idling.",
  },
  {
    name: "12V Motorcycle Battery (5Ah)",
    brand: "Exide",
    category: "Electrical",
    compatibleModels: ["Honda CB Shine", "Honda Dio"],
    price: 2600,
    stock: 15,
    description: "Maintenance-free sealed battery, reliable cold starts even in winter mornings.",
  },
  {
    name: "LED Headlight Bulb H4",
    brand: "Philips",
    category: "Electrical",
    compatibleModels: ["Universal — H4 fitting"],
    price: 1200,
    stock: 30,
    description: "Bright white LED replacement for better night visibility on unlit roads.",
  },
  {
    name: "Digital Speedometer Console",
    brand: "Bajaj Genuine",
    category: "Electrical",
    compatibleModels: ["Bajaj Pulsar 150"],
    price: 3800,
    stock: 10,
    description: "OEM replacement digital cluster showing speed, odometer, and fuel gauge.",
  },
  {
    name: "Side Mirror Set (Pair)",
    brand: "Universal Fit",
    category: "Body & Frame",
    compatibleModels: ["Universal — standard thread"],
    price: 750,
    stock: 35,
    description: "Wide-view mirror pair, standard 10mm thread fits most commuter bikes.",
  },
  {
    name: "Seat Cover (Waterproof)",
    brand: "Universal Fit",
    category: "Body & Frame",
    compatibleModels: ["Bajaj Pulsar 150", "Bajaj Pulsar 160"],
    price: 900,
    stock: 28,
    description: "Grippy, waterproof seat cover to survive monsoon rides.",
  },
  {
    name: "Full-Face Helmet (ISI Marked)",
    brand: "Steelbird",
    category: "Helmets & Gear",
    compatibleModels: ["Universal"],
    price: 2450,
    stock: 22,
    description: "ISI-certified full-face helmet with clear visor, built for daily riding safety.",
  },
  {
    name: "Riding Gloves",
    brand: "Royal Enfield Gear",
    category: "Helmets & Gear",
    compatibleModels: ["Universal"],
    price: 1350,
    stock: 33,
    description: "Knuckle-protected riding gloves with breathable mesh panels.",
  },
  {
    name: "Bike Cover (All-Weather)",
    brand: "Universal Fit",
    category: "Accessories",
    compatibleModels: ["Universal — fits most 100–160cc bikes"],
    price: 1100,
    stock: 40,
    description: "Dust and rain-resistant cover to protect your bike when parked outdoors.",
  },
  {
    name: "Mobile Phone Holder Mount",
    brand: "Universal Fit",
    category: "Accessories",
    compatibleModels: ["Universal — handlebar clamp"],
    price: 550,
    stock: 50,
    description: "Secure handlebar mount for navigation on delivery and long rides.",
  },
];

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function seedProducts({ replace = false } = {}) {
  if (!replace && await Product.exists({})) return;
  if (replace) await Product.deleteMany({});
  const withSlugs = products.map((p) => ({ ...p, slug: slugify(`${p.brand}-${p.name}`) }));
  await Product.insertMany(withSlugs);
  console.log(`Seeded ${withSlugs.length} catalog products.`);
}

if (require.main === module) {
  const connectDB = require("../config/db");
  connectDB().then(() => seedProducts({ replace: process.argv.includes("--replace") }))
    .catch((error) => { console.error("Seeding failed:", error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { seedProducts };
