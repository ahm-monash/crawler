import { Package, PackageLanguage } from "../entities/package";
import { PackageRepository } from "./package";

import { Database, openDatabase } from "../database";

//db to use thoughout tests
let db: Database;

//use a blank in-memory database for tests
beforeEach(async () => {
	db = await openDatabase(':memory:');
});

afterEach(async () => {
	await db.close();
});


test('Create Package', async () => {
	
	const packageRepository = new PackageRepository(db);

	const p:Package = {
		id: undefined,
		name: "test package",
		description: "test package description",
		nodeVersion: "1.0.0",
		internal: true,
		lang: PackageLanguage.JavaScript,
		version: "1.0.0",
		repoUrl: "...",
		npmUrl: "...",
		lastUpdated: new Date(),
		lastCrawled: new Date()
	}

	await packageRepository.create(p)
	
	expect(p.id).toBeDefined()
	
	//ensure that p2 is equal to p
	const p2 = await packageRepository.getById(p.id)

	expect(p2.id).toBeDefined()
	expect(p2.name).toBe(p.name)
	expect(p2.description).toBe(p.description)
	expect(p2.nodeVersion).toBe(p.nodeVersion)
	expect(p2.internal).toBe(p.internal)
	expect(p2.lang).toBe(p.lang)
	expect(p2.version).toBe(p.version)
	expect(p2.repoUrl).toBe(p.repoUrl)
	expect(p2.npmUrl).toBe(p.npmUrl)

	//milliseconds are lost
	const lastUpdated = new Date(p.lastUpdated)
	lastUpdated.setMilliseconds(0)
	expect(p2.lastUpdated.getTime()).toBe(lastUpdated.getTime())
	
	//milliseconds are lost
	const lastCrawled = new Date(p.lastCrawled)
	lastCrawled.setMilliseconds(0)
	expect(p2.lastCrawled.getTime()).toBe(lastCrawled.getTime())
});

