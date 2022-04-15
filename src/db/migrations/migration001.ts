/**
 * migration001 represents the first migration, 
 * i.e. the one where the database is created.
 */

import { Database } from "../database";



/**
 * runMigrations runs the migration on a database instance.
 * This function is idempotent. 
 * @param db the database instance to run the migration on.
 */
export async function runMigrations(db: Database) {

	//create the package table
	await db.run(`
		CREATE TABLE IF NOT EXISTS package (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT,
			nodeVersion TEXT,
			internal BOOLEAN,
			lang TEXT CHECK(lang IN ('js', 'ts')),
			version TEXT,
			repoUrl TEXT,
			npmUrl TEXT,
			lastUpdated TIMESTAMP,
			lastCrawled TIMESTAMP
		)`);

	//create the dependency table
	await db.run(`
		CREATE TABLE IF NOT EXISTS dependency (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			masterId INTEGER NOT NULL,
			slaveId INTEGER NOT NULL,
			usedVersion TEXT,
			type TEXT CHECK(type IN ('prod', 'dev')),
			
			FOREIGN KEY(masterId) REFERENCES package(id) ON DELETE CASCADE,
			FOREIGN KEY(slaveId) REFERENCES package(id) ON DELETE CASCADE
		)`);
}