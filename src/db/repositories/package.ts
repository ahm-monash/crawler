import { Package } from "../entities/package";
import { Repository } from "./repository"

/**
 * PackageRepository provides a set of functions to handle Packages.
 */
export class PackageRepository extends Repository {
	TABLE_NAME = "package"

	/**
	 * This is an helper function to fix some of the type of properties after they are retrieved from the daabase.
	 * @param dbPackage the data returned by the database corresponding to a single row
	 */
	private fixTypes(dbPackage:any){
		//internal should be a boolen but it is actually returned as number 0/1
		if(typeof dbPackage?.internal === "number"){
			dbPackage.internal = Boolean(dbPackage.internal);
		}

		//lastCrawled should be a Date but it is actually returned as a string
		if(dbPackage.lastUpdated != null){
			dbPackage.lastUpdated = new Date(dbPackage.lastUpdated);
		}

		//lastCrawled should be a Date but it is actually returned as a string
		if(dbPackage.lastCrawled != null){
			dbPackage.lastCrawled = new Date(dbPackage.lastCrawled);
		}
	}

	/**
	 * Create a new package.
	 * p.id will be set to its new id.
	 * @param p the Package to create
	 */
	async create(p: Package): Promise<void> {
		const result = await this.db.run(`
		INSERt INTO ${this.TABLE_NAME} (
			name,
			description,
			nodeVersion,
			internal,
			lang,
			version,
			repoUrl,
			npmUrl,
			lastUpdated,
			lastCrawled
		) VALUES (
			?,
			?,
			?,
			?,
			?,
			?,
			?,
			?,
			?,
			?
		)`, [p.name, p.description, p.nodeVersion, p.internal, p.lang, p.version, p.repoUrl, p.npmUrl, p.lastUpdated, p.lastCrawled]);
		
		p.id = result.lastID || 0;
	}

	/**
	 * Get a package by id
	 * @param id 
	 * @returns the package or undefined if not found
	 */
	async getById(id: number): Promise<Package | undefined> {
		const result = await this.db.get(`
		SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`, [id]);
		this.fixTypes(result);
		return result as Package;
	}

}


