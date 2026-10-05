/** KALEA — initialisation forcée de la base (npm run seed). */
import { getDb, closeDb } from '../db.js';
import { seed } from '../services/seed.js';

getDb();
seed();
console.log('Base de données initialisée.');
closeDb();
