import { initDB } from '../db.js';

async function migrate() {
  const db = await initDB();
  
  try {
    // Add role column with check constraint
    await db.exec(`
      BEGIN TRANSACTION;
      
      -- Create users table if not exists
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'STUDENT'
          CHECK (role IN ('ADMIN', 'TA', 'STUDENT'))
      );
      
      -- Update existing roles to uppercase
      UPDATE users SET role = UPPER(role) WHERE role IN ('admin', 'ta', 'student');
      
      -- Create audit log table for tracking admin actions
      CREATE TABLE IF NOT EXISTS auditLog (
        id TEXT PRIMARY KEY,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        userId TEXT NOT NULL,
        action TEXT NOT NULL,
        resourceId TEXT,
        details TEXT,
        FOREIGN KEY (userId) REFERENCES users(id)
      );
      
      -- Create analytics view for admins
      CREATE VIEW IF NOT EXISTS resourceAnalytics AS
      SELECT 
        r.id as resourceId,
        r.name as resourceName,
        COUNT(DISTINCT b.id) as totalBookings,
        SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END) as confirmedBookings,
        SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) as cancelledBookings,
        SUM(CASE WHEN b.status = 'waitlisted' THEN 1 ELSE 0 END) as waitlistedBookings,
        CAST(SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END) AS FLOAT) / 
          NULLIF(COUNT(DISTINCT s.id), 0) as utilization
      FROM resources r
      LEFT JOIN slots s ON s.resourceId = r.id
      LEFT JOIN bookings b ON b.slotId = s.id
      GROUP BY r.id, r.name;
      
      -- Create resources table
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Create slots table
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        resourceId TEXT NOT NULL,
        start DATETIME NOT NULL,
        end DATETIME NOT NULL,
        blocked BOOLEAN DEFAULT FALSE,
        blockedLabel TEXT,
        FOREIGN KEY (resourceId) REFERENCES resources(id)
      );

      -- Create bookings table
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        slotId TEXT NOT NULL,
        userId TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('confirmed', 'waitlisted', 'cancelled')),
        waitlistPosition INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (slotId) REFERENCES slots(id),
        FOREIGN KEY (userId) REFERENCES users(id)
      );
      
      COMMIT;
    `);
    
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    await db.exec('ROLLBACK');
    throw err;
  }
}

migrate().catch(console.error);