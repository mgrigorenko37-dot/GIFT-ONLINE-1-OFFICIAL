const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.SQL_HOST,
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DB_NAME,
});

const GIFTS_CATALOG = [
  { name: 'Plush Pepe', stars: 602997 },
  { name: 'Heart Locket', stars: 124977 },
  { name: 'Telegram Cap', stars: 40637 },
  { name: 'Plum', stars: 26165 },
  { name: 'Spartan Helmet', stars: 16793 },
  { name: 'Diamond Crystal', stars: 11881 },
  { name: 'Birkin Bag', stars: 11406 },
  { name: 'Golden Biceps', stars: 11161 },
  { name: 'Nail Bracelet', stars: 11075 },
  { name: 'Sunglasses', stars: 10517 },
  { name: 'Vulcan Hand', stars: 10443 },
  { name: 'Black Cat', stars: 9775 },
  { name: 'Perfume Bottle', stars: 7468 },
  { name: 'Oscar Trophy', stars: 7233 },
  { name: 'Magic Crystals', stars: 6963 },
  { name: 'Diamond Ring', stars: 6159 },
  { name: 'Gold Ticket', stars: 5965 },
  { name: 'Poison Bottle', stars: 5894 },
  { name: 'Snoop Dogg Lowrider', stars: 5178 },
  { name: 'Gold Rolex Watch', stars: 4824 },
  { name: 'Vampire Lips', stars: 4018 },
  { name: 'Frog with Kiss', stars: 4018 },
  { name: 'Pink Helmet', stars: 3839 },
  { name: 'Gold Bangle', stars: 3749 },
  { name: 'Teddy Bear', stars: 3658 },
  { name: 'Cigar', stars: 3555 },
  { name: 'Voodoo Doll', stars: 3478 },
  { name: 'Signet Ring', stars: 3300 },
  { name: 'Genie Lamp', stars: 3208 },
  { name: 'Eternal Rose', stars: 2412 },
  { name: 'Ushanka Hat', stars: 2406 },
  { name: 'Skull', stars: 2359 },
  { name: 'Gold Pacifier', stars: 2312 },
  { name: 'Crystal Eagle', stars: 2278 },
  { name: 'Fairy Heels', stars: 1787 },
  { name: 'Hair Dryer', stars: 1553 },
  { name: 'UFC Mystery Box', stars: 1387 },
  { name: 'Heart Cobweb', stars: 1340 },
  { name: 'Love Potion', stars: 1339 },
  { name: 'Joint Cigar', stars: 1331 },
  { name: 'Vinyl Player', stars: 1161 },
  { name: 'Broomstick', stars: 1072 },
  { name: 'Pumpkin', stars: 1067 },
  { name: 'Heart Chocolates', stars: 1063 },
  { name: 'Skull Flower', stars: 981 },
  { name: 'Top Hat', stars: 970 },
  { name: 'Sakura', stars: 929 },
  { name: 'Fountain Pen', stars: 920 },
  { name: 'Heart Candle', stars: 835 },
  { name: 'Plush Star', stars: 804 },
  { name: 'Jingle Bells', stars: 794 },
  { name: 'Mochi Bunny', stars: 750 },
  { name: 'Strawberries Box', stars: 749 },
  { name: 'Dog Love Bouquet', stars: 714 },
  { name: 'Monkey Cymbals', stars: 711 },
  { name: 'Eyeball', stars: 688 },
  { name: 'Surfboard', stars: 661 },
  { name: 'Easter Bunny', stars: 625 },
  { name: 'Lightsaber', stars: 625 },
  { name: 'Ring Box', stars: 625 },
  { name: 'Crescent Star Pendant', stars: 625 },
  { name: 'Mushroom', stars: 625 },
  { name: 'Cupcake', stars: 625 },
  { name: 'Candle', stars: 625 },
  { name: 'Bell', stars: 625 },
  { name: 'Snoop Dog', stars: 625 },
  { name: 'Crescent Mosque', stars: 622 },
  { name: 'Birthday Cake', stars: 620 },
  { name: 'Gingerbread Heart', stars: 617 },
  { name: 'Happy B-day', stars: 600 },
  { name: 'Money Bouquet', stars: 600 },
  { name: 'Cherry Cake', stars: 599 },
  { name: 'Gold Medal', stars: 595 },
  { name: 'Peony Bouquet', stars: 590 },
  { name: 'Jar of Hearts', stars: 580 },
  { name: 'Bow Tie', stars: 580 },
  { name: 'Witch Hat', stars: 580 },
  { name: 'Sparkler', stars: 561 },
  { name: 'Weed Bag', stars: 560 },
  { name: 'Socks', stars: 559 },
  { name: 'Book', stars: 559 },
  { name: 'Four Leaf Clover', stars: 555 },
  { name: 'Birthday Calendar', stars: 550 },
  { name: 'Mittens', stars: 539 },
  { name: 'Backpack Telegram', stars: 520 },
  { name: 'Mulled Wine', stars: 525 },
  { name: 'Lollipop', stars: 513 },
  { name: 'Notebook', stars: 510 },
  { name: 'Poop Emoji', stars: 500 },
  { name: 'Jester Hat', stars: 500 },
  { name: 'Gingerbread Man', stars: 500 },
  { name: 'Jack in the Box', stars: 500 },
  { name: 'Snow Globe', stars: 490 },
  { name: 'Tamagotchi', stars: 482 },
  { name: 'Red Snake', stars: 475 },
  { name: 'Potion Cauldron', stars: 475 },
  { name: 'Space Rocket', stars: 470 },
  { name: 'Statue of Liberty', stars: 470 },
  { name: 'Salad Bowl', stars: 450 },
  { name: 'Ice Cream', stars: 439 },
  { name: 'Easter Egg', stars: 425 },
  { name: 'Gift Box 2025', stars: 410 },
  { name: 'Santa Hat', stars: 410 },
  { name: 'Hot Cocoa', stars: 400 },
  { name: 'Rainbow Lollipop', stars: 400 },
  { name: 'Coffee Cup', stars: 399 },
  { name: 'Numbers 2025', stars: 398 },
  { name: 'Christmas Wreath', stars: 388 },
  { name: 'Liberty Torch', stars: 385 },
  { name: 'Fast Food Noodles', stars: 380 },
  { name: 'Xmas Stocking', stars: 380 },
  { name: 'Candy Cane', stars: 376 },
  { name: 'Snake 2025', stars: 370 },
  { name: 'Flamingo', stars: 370 },
];

const MODELS = ['Classic', 'Gold', 'Neon', 'Cyber', 'Diamond'];
const BACKDROPS = ['Dark', 'Matrix', 'Royal', 'Cyberpunk', 'Velvet', 'Sunset'];
const PATTERNS = ['Geometric', 'Stars', 'Hearts', 'Code', 'None'];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM gift_variants');
    await client.query('DELETE FROM gift_collections');

    for (const gift of GIFTS_CATALOG) {
      const basePriceTon = (gift.stars * 0.002).toFixed(2);
      const giftId = gift.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      await client.query(
        `
        INSERT INTO gift_collections (id, name, floor_price_gx, image_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
      `,
        [giftId, gift.name, basePriceTon, '']
      );

      // Generate 3 unique variants per gift
      for (let i = 0; i < 3; i++) {
        const model = MODELS[Math.floor(Math.random() * MODELS.length)];
        const backdrop = BACKDROPS[Math.floor(Math.random() * BACKDROPS.length)];
        const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];

        let symbolBase = gift.name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
        const symbol = `${symbolBase}_${model.toUpperCase()}`;

        await client.query(
          `
          INSERT INTO gift_variants (id, collection_id, model_name, symbol_name, rarity_percentage, backdrop_color, current_price_gx)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (id) DO NOTHING
        `,
          [symbol, giftId, model, symbol, 10, backdrop, basePriceTon]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Successfully seeded 115 gifts into existing tables.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
