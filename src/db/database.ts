
import { Database as sqliteDatabase, open } from 'sqlite'
import {Database as sqlite3Database, Statement } from 'sqlite3'
import { runMigrations } from './migrations/migration001'

export type Database = sqliteDatabase<sqlite3Database, Statement>

/**
 * Opens or creates a SQLite database and runs the migrations. 
 * @param filename the file name of the SQLite database, pass :memory: for an in-memory one
 */
export async function openDatabase(filename:string){

    const db = await open({
      filename: filename,
      driver: sqlite3Database
    })

	await runMigrations(db)

	return db
}