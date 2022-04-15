
import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { getPackageManifest } from "query-registry";
import { RequestCounter } from "./rate-limiting/request-counter";
import { TokenBucket } from "./rate-limiting/token-bucket";
import { sleep, getAccessToken } from "./utils";
import { printHashBar, printSpacer } from "./ioFormatting";

var Map = require('es6-map');

//Ratelimiter is a POJO that contains a TokenBuckets and RequestCounters for each API source.
type RateLimiter = {
	Github: {
		tokenBucket: TokenBucket,
		reqCounter: RequestCounter
	},
	npm: {
		tokenBucket: TokenBucket,
		reqCounter: RequestCounter
	}
}

//Declaring a type alias for representing a repository in order to avoid this octokit mess
type Repository = RestEndpointMethodTypes["repos"]["listForOrg"]["response"]["data"][0]

// Defining the GitHub API client.
let octokit: Octokit

/*
Print a nice report for the given repository
*/
async function printDependencies(packageJsonContent: any, repo: Repository, dependenciesVersions: any, dependencies: [string, string][]){
	const name = packageJsonContent?.name;
	const version = packageJsonContent?.version;
	const description = packageJsonContent?.description;
	const keywords = packageJsonContent?.keywords;

	printHashBar()

	// Extract and print some information that might be useful for future use.
	console.log("GitHub information:")
	console.log("Name:", repo.name)
	console.log("Description:", repo.description ? repo.description : "[Missing]")
	console.log("Language:", repo.language ? repo.language : "[Missing]")
	console.log("Last Updated:", repo.updated_at ? repo.updated_at : "[Missing]")

	console.log()

	// Extract and print some information that might be useful for future use.
	console.log("package.json information:")

	console.log("Name:", name ? name : "[Missing]");
	console.log("Version:", version ? version : "[Missing]");
	console.log("Description:", description ? description : "[Missing]");
	console.log("Keywords:", keywords ? keywords : "");

	console.log()
	console.log()
	console.log("Dependencies:")

	if (dependenciesVersions.length === 0) {
		console.log("\t None found")
	}

	for(const [dependency, version] of dependenciesVersions){
		console.log("\t", dependency, " - Used version:", dependencies[dependency], "| Latest version:", version)
	}

	printHashBar()
	console.log()
}

function printRateLimitInfo(startTime: Date, endTime: Date, rateLimiter: RateLimiter){
	const elapsedInMinutes = (endTime.getTime() - startTime.getTime()) / 1000 / 60

	let printRT = function printRequestTimes(name: string, total: number){
		console.log(name, " requests:")
		console.log("\t",
			"Total:",
			total,
			"Average:",
			(total / (elapsedInMinutes * 60)).toFixed(2),
			"reqs/s")
	}

	printSpacer()

	console.log("Elapsed time:", elapsedInMinutes.toFixed(2), "minutes")

	printRT("Github", rateLimiter.Github.reqCounter.getTotalRequests())
	printRT("npm", rateLimiter.npm.reqCounter.getTotalRequests())
	printRT("Total", rateLimiter.Github.reqCounter.getTotalRequests() + rateLimiter.npm.reqCounter.getTotalRequests())
}

//Find dependencies of a repository
async function findDependencies(repo: Repository, rateLimiter: RateLimiter): Promise<[string, string, string, boolean, any, [string, string][]]> {

	// Get main_branch name from repo
	await rateLimiter.Github.tokenBucket.waitForTokens(1)
	rateLimiter.Github.reqCounter.addRequest()
	const r = await octokit.repos.get({
		owner: "octokit",
		repo: repo.name,
	});

	const main_branch = r.data.master_branch || "master";

	// Get branch sha from branch
	await rateLimiter.Github.tokenBucket.waitForTokens(1)
	rateLimiter.Github.reqCounter.addRequest()
	const branch = await octokit.repos.getBranch({
		owner: "octokit",
		repo: repo.name,
		branch: main_branch,
	});

	const sha = branch.data.commit.sha;

	// Get the repo tree, i.e. the list of all file and folder names in the repo.
	// This is a recursive call, meaning even files inside folders will be returned.
	// TODO: handle the case where the repo has a tree too big to be returned in one recursive call and must be paginated
	await rateLimiter.Github.tokenBucket.waitForTokens(1)
	rateLimiter.Github.reqCounter.addRequest()
	const tree = await octokit.git.getTree({
		owner: "octokit",
		repo: repo.name,
		tree_sha: sha,
		recursive: "yes",
	})

	if (tree.data.truncated) {
		console.log("Tree is truncated, we are missing some data :(");
	}

	//filter for package.json files
	const packageJsons = tree.data.tree
		.filter(item => item.path.endsWith("package.json"))

	if (packageJsons.length === 0) {
		console.log("No package.json found");
		return
	}
	if (packageJsons.length > 1) {
		//console.log("More than one package.json found");
		//TODO: handle the case in which multiple package.json files are found
	}

	const packageJson = packageJsons[0];

	// Download and parse the content of the package.json
	await rateLimiter.Github.tokenBucket.waitForTokens(1)
	rateLimiter.Github.reqCounter.addRequest()
	const packageJsonContent = await octokit.repos.getContent({
		owner: "octokit",
		repo: repo.name,
		path: packageJson.path,
	})
		.then(res => (res.data as any)?.content)                     //the content keyword is not guaranteed to be present in the response
		.then(content => {
			if (content === null) {
				throw new Error("package.json is empty");
			}
			return content as string;
		})
		.then(content => Buffer.from(content, 'base64').toString())  // the content is served as base64, so we need to decode it into a string
		.then(content => JSON.parse(content));						 // parse the JSON in the package.json

	//Use the npm api to get the version of dependencies
	const dependencies = packageJsonContent?.dependencies || {}
	//We'll store them here to print them later
	const dependenciesVersions: [string, string][] = []

	for (const dependency in dependencies) {
		await rateLimiter.npm.tokenBucket.waitForTokens(1)
		rateLimiter.npm.reqCounter.addRequest()
		const manifest = await getPackageManifest({ name: dependency })

		dependenciesVersions.push([dependency, manifest.version])
	}

	await printDependencies(packageJsonContent, repo, dependenciesVersions, dependencies)

	const name = packageJsonContent?.name;
	const version = packageJsonContent?.version;
	return [name, version, branch.data._links.html, r.data.archived, dependencies, dependenciesVersions]
}

function depDataToJson(nameMap: Map<string, number>, data: Map<number, {version: string, link: string, internal: boolean, archived: boolean}>): string{
	let res = ""

	res += '{'

	for(const [name, id] of nameMap){
		const thisData = data.get(id)
		res += "\"" + id.toString() + "\": {"
		res += "\"name\": \"" + name + "\","
		res += "\"version\": \"" + thisData.version  + "\","
		res += "\"link\": \"" + thisData.link + "\","
		res += "\"internal\": " + thisData.internal + ","
		res += "\"archived\": " + thisData.archived + ""
		res += "}, "
	}

	//Remove extra comma, as trailing commas aren't allowed in JSON
	if(res.length > 2){
		res = res.slice(0, -2)
	}

	res += '}'

	return res
}

function generateDependencyTree(data: Awaited<ReturnType<typeof findDependencies>>[]): any {
	let depNameMap: Map<string, number> = new Map();

	let depData: Map<number, {version: string, link: string, internal: boolean, archived: boolean}> = new Map();

	let repos: any[] = [];

	//This version here is wrong, we only use it if we have nothing else (it will get overwritten later)
	for (const [name, version, link, isArchived, dependencies, newest] of data) {
		if (!depNameMap.has(name)) {
			depNameMap.set(name, depNameMap.size)
			depData.set(depNameMap.get(name), {version: version ? version : "", link: link, internal: true, archived: isArchived})
		} else{
			depData.get(depNameMap.get(name)).link = link
			depData.get(depNameMap.get(name)).internal = true
		}

		//TODO: The newest array shouldn be shared across all dependencies
		for (const [depName, depVersion] of newest) {
			if (!depNameMap.has(depName)) {
				depNameMap.set(depName, depNameMap.size)
				depData.set(depNameMap.get(depName), {version: "", link: "", internal: false,  archived: false})
			}
			depData.get(depNameMap.get(depName)).version = depVersion
		}

		let deps = []

		for (const depName in dependencies) {
			const depVersion = dependencies[depName]
			if (!depNameMap.has(depName)) {
				depNameMap.set(depName, depNameMap.size)
				depData.set(depNameMap.get(depName), {version: "", link: "", internal: false,  archived: false})
			}
			deps.push([depNameMap.get(depName), depVersion])
		}

		repos.push({
			dep: depNameMap.get(name),
			dependencies: deps,
		})
	}

	console.log(depNameMap)
	console.log(depData)

	console.log(depDataToJson(depNameMap, depData))

	// //I honestly have no idea
	// interface Dependency {
	// 	name: string;
	// 	version: string;
	//   }

	// let depNames: Record<number, Dependency> = {};
	// for(const [depName, id] of Object.entries(depNameMap)){
	// 	console.log(id.toString() + ' ' + depName + ' ' +  versions[id])
	// 	depNames[id.toString()] = {name: depName, version: versions[id]}
	// }
	// console.log(depNames)
	//return [depNames, repos]
	return repos
}

//Main function
async function main() {
	const accessToken = getAccessToken()

	octokit = new Octokit({
		auth: accessToken,
		log: {
			debug: () => { },
			info: () => { },
			warn: console.warn,
			error: console.error,
		},
		request: {
			agent: undefined,
			fetch: undefined,
			timeout: 30000,
		}
	})

	// List the public repositories owned by the octokit organization:
	const repos = await octokit.repos.listForOrg({
		org: "octokit",
		type: "public",
		per_page: 100,  //TODO: implement pagination
	});

	// Filter for repositories written in javascript or typescript.
	//!	Note, some repositories might not have a .language property set. 
	const jsOrTsRepos = repos.data
		.filter(repo => repo.language === "TypeScript" || repo.language === "JavaScript")

	const rateLimiter: RateLimiter = {
		Github: {
			// Github api allows 5000 reqs per hour. 5000/3600 = 1.388 reqs per second.
			tokenBucket: new TokenBucket(100, 1.388, 0),
			reqCounter: new RequestCounter(10000, "GitHub")
		},
		npm: {
			// Some sources suggest npm allows up to 5 million requests per month.
			// 5000000 / (3600 * 24 *  30) = 1.929 reqs per second
			tokenBucket: new TokenBucket(100, 1.929, 0),
			reqCounter: new RequestCounter(10000, "npm")
		}
	}

	const startTime = new Date();

	let allDepPromises: ReturnType<typeof findDependencies>[] = [];

	// For each repository, find its dependencies
	for (const repo of jsOrTsRepos) {
		allDepPromises.push(findDependencies(repo, rateLimiter))

		//! This doesn't have much sense here, but I decided to leave it here to avoid forgetting about it.
		//Avoid building of backpressure if the queues are too long
		// if (rateLimiter.Github.tokenBucket.getQueueLength() + rateLimiter.npm.tokenBucket.getQueueLength() > 1000) {
		// 	//wait for the queue length to reach length 0 by probing queue length every second
		// 	console.log("Waiting for queues to drain")
		// 	await Promise.all([
		// 		rateLimiter.Github.tokenBucket.waitForShorterQueue(1000),
		// 		rateLimiter.Github.tokenBucket.waitForShorterQueue(1000),
		// 	])
		// }
	}

	const allDeps: Awaited<ReturnType<typeof findDependencies>>[] =  await Promise.all(allDepPromises);

	//Wait for all requests to finish
	console.log("Waiting for all requests to finish")
	await Promise.all([
		rateLimiter.Github.tokenBucket.waitForShorterQueue(1000),
		rateLimiter.npm.tokenBucket.waitForShorterQueue(1000),
	])

	//Cleanup the req counters
	rateLimiter.Github.reqCounter.pause()
	rateLimiter.npm.reqCounter.pause()

	//Print req counters report
	const endTime = new Date();

	//At this point the bucket queue will be empty, but there might still be some requests in flight.
	await sleep(3000)

	printRateLimitInfo(startTime, endTime, rateLimiter);

	console.log(JSON.stringify(generateDependencyTree(allDeps)))
}

main()




