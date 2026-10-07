import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;
  const col = db.collection('message_templates');
  
  try {
    const indexes = await col.indexes();
    console.log('Existing indexes:', indexes);
    
    // Attempt to drop old index if exists
    try {
      await col.dropIndex('userId_1_name_1_language_1');
      console.log('Dropped userId_1_name_1_language_1');
    } catch (e) {
      console.log('Index userId_1_name_1_language_1 not found, trying user_id_1_name_1_language_1...');
      try {
        await col.dropIndex('user_id_1_name_1_language_1');
        console.log('Dropped user_id_1_name_1_language_1');
      } catch(err2) {
        console.log('Could not drop old index (maybe it does not exist)', err2.message);
      }
    }
    
    // Create new index
    await col.createIndex({ account_id: 1, name: 1, language: 1 }, { unique: true });
    console.log('Created new unique index on account_id, name, language');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await mongoose.disconnect();
  }
}

migrate();
