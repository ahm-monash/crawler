import { Package, PackageLanguage } from "../entities/package";
import { PackageRepository } from "./package";

import { Database, openDatabase } from "../database";
import { DependencyRepository } from "./dependency";
import { Dependency, DependencyType } from "../entities/dependency";

//database to be used througout tests
let db: Database;

//this is a mock package used for testing
const master:Package = {
	id: undefined,
	name: "master",
	description: "master test package description",
	nodeVersion: "1.0.0",
	internal: true,
	lang: PackageLanguage.JavaScript,
	version: "1.0.0",
	repoUrl: "...",
	npmUrl: "...",
	lastUpdated: new Date(),
	lastCrawled: new Date()
}

//this is a mock package used for testing
const slave:Package = {
	id: undefined,
	name: "slave",
	description: "slave test package description",
	nodeVersion: "1.0.0",
	internal: true,
	lang: PackageLanguage.JavaScript,
	version: "1.0.0",
	repoUrl: "...",
	npmUrl: "...",
	lastUpdated: new Date(),
	lastCrawled: new Date()
}

//use a blank in-memory database for tests
beforeEach(async () => {
	db = await openDatabase(':memory:');
	const pRep = new PackageRepository(db)
	await pRep.create(master);
	await pRep.create(slave);
});

afterEach(async () => {
	await db.close();
	master.id = undefined;
	slave.id = undefined;
});


test('Create Dependency', async () => {

	const dependencyRepository = new DependencyRepository(db);

	const d:Dependency = {
		id: undefined,
		masterId: master.id,
		slaveId: slave.id,
		usedVersion: "1.0.0",
		type: DependencyType.Production
	}

	await dependencyRepository.create(d)

	expect(d.id).toBeDefined()

	//ensure that d2 is equal to d
	const d2 = await dependencyRepository.getById(d.id)
	console.log(d2)
	expect(d2.id).toBe(d.id)
	expect(d2.masterId).toBe(d.masterId)
	expect(d2.slaveId).toBe(d.slaveId)
	expect(d2.usedVersion).toBe(d.usedVersion)
	expect(d2.type).toBe(d.type)
});

