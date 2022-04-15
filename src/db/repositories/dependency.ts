import { Dependency } from "../entities/dependency";
import { Repository } from "./repository";

/**
 * DependencyRepository provides a set of functions to handle dependencies.
 */
export class DependencyRepository extends Repository{

	TABLE_NAME = "dependency";

	/**
	 * create a new dependency.
	 * d.id will be set to the new id.
	 * @param d the Dependency to add
	 */
	async create(d:Dependency){
		const result = await this.db.run(`
		INSERt INTO ${this.TABLE_NAME} (
			masterId,
			slaveId,
			usedVersion,
			type
		) VALUES (
			?,
			?,
			?,
			?
		)`, [d.masterId, d.slaveId, d.usedVersion, d.type]);
		
		d.id = result.lastID || 0;
	}

	/**
	 * Get a dependency by id
	 * @param id the dependency id
	 * @returns 
	 */
	async getById(id:number){
		const result = await this.db.get(`
		SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`, [id]);
		return result as Dependency;
	}

}