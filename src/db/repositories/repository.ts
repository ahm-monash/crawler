import { Database } from "../database"

/**
 * Repository is a base class for all repositories.
 */
export class Repository{
	protected db:Database

	constructor(db:Database){
		this.db = db
	}
}