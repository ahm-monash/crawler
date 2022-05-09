import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { TokenBucket } from "./rate-limiting/token-bucket";
import { getAccessToken, loadConfig, sleep, writeFile } from "./utils";
import { generateDependencyTree } from "./outputData";
import { getDependenciesNpm, getDependenciesPyPI, Repository, APIParameters, PackageRateLimiter } from "./packageAPI";
import { DependencyGraphDependency, GraphResponse, OrgRepos, RepoEdge, BranchManifest, UpperBranchManifest, queryDependencies, queryRepositories } from "./graphQLAPI"

//var Map = require("es6-map");

//Declaring a type alias for representing a repository in order to avoid this octokit mess
type OctokitRepository =
	RestEndpointMethodTypes["repos"]["listForOrg"]["response"]["data"][0];

// Defining the GitHub API client.
let octokit: Octokit;

// returns list of repo objects
function getRepos(response: GraphResponse) {
	const allRepos: RepoEdge[] = response?.organization?.repositories?.edges;
	let filteredRepos: BranchManifest[] = []
	for (const repo of allRepos) {
		//console.log(repo);
		const ref = repo.node.mainBranch ? repo.node.mainBranch : repo.node.masterBranch;
		if (ref == null) {
			continue
		}

		filteredRepos.push(ref)
	}
	return filteredRepos
}

// get dependencies of a repo obj, used by function getAllRepoDeps(repoList)
// returns object with repo name and list of blob paths ending with package.json and blob path's dependencies
function getRepoDependencies(repo: BranchManifest) {
	const packageManagers = [
		{ name: "NPM", extensions: ["package.json"] },
		{ name: "PYPI", extensions: ["requirements.txt"] },
	]

	function blobPathDeps(subPath: string, blobPath: string, version: string, deps: DependencyGraphDependency[]) {
		return { subPath: subPath, blobPath: blobPath, version: version, dependencies: deps }
	}

	let repoDepObj: {
		manifest: UpperBranchManifest, packageMap: Map<string, ReturnType<typeof blobPathDeps>[]>
	} = { manifest: repo.repository as UpperBranchManifest, packageMap: null }

	repoDepObj.packageMap = new Map()

	const depGraphManifests = repo.repository.dependencyGraphManifests
	const files = depGraphManifests.edges
	let index = 0
	// iterate through all files in repo to find the ones with package.json
	for (const file of files) {
		const blobPath = file.node.blobPath;
		const subPath = depGraphManifests.nodes[index].filename
		index += 1;
		for (const packageManager of packageManagers) {
			for (const ext of packageManager.extensions) {
				// check path ends with extension
				if (subPath.endsWith(ext)) {
					console.log(blobPath + ", " + subPath)
					const version = ""//file.node.version
					const depCount = file.node.dependencies.totalCount

					if (!repoDepObj.packageMap.has(packageManager.name)) {
						repoDepObj.packageMap.set(packageManager.name, [])
					}

					if (depCount > 0) {
						const dependencies = file.node.dependencies.nodes
						const blobPathDep = blobPathDeps(subPath, blobPath, version, dependencies)
						repoDepObj.packageMap.get(packageManager.name).push(blobPathDep)
					} else {
						// currently includes package.json files with no dependencies
						const blobPathDep = blobPathDeps(subPath, blobPath, version, [])
						repoDepObj.packageMap.get(packageManager.name).push(blobPathDep)
					}
				}
			}
		}
	}

	return repoDepObj
}

// get dependencies of all repos in repoList, repolist: list of repo objects
// repoList generated by getPkgJSONRepos()
function getAllRepoDeps(repoList: BranchManifest[]) {
	let all_dependencies: ReturnType<typeof getRepoDependencies>[] = []
	for (const repo of repoList) {
		const deps = getRepoDependencies(repo)
		if (deps.packageMap.size > 0) {
			all_dependencies.push(deps)
		}
	}
	return all_dependencies
}

function mergeDependenciesLists(managerRepos: Map<string, Repository[]>): Map<string, string[]> {
	let deps: Map<string, Set<string>> = new Map()

	for (const [packageManager, repos] of managerRepos) {
		//console.log(packageManager)
		for (const repo of repos) {
			for (const [name, version] of repo.dependencies) {
				//console.log("\t" + name)
				if (!deps.has(packageManager)) { deps.set(packageManager, new Set()) }
				deps.get(packageManager).add(name);
			}
		}
	}

	let managerDeps: Map<string, string[]> = new Map()

	for (const [key, value] of deps) {
		managerDeps.set(key, Array.from(value.values()))
	}

	return managerDeps
}

//The minimum amount of github points needed in oreder to scrape an Organisation
//Note: This value is just a guess.	
const MINIMUM_GITHUB_POINTS = 10;

async function scrapeOrganisation(config: ReturnType<typeof loadConfig>, accessToken: string) {
	let allDeps: Map<string, Repository[]> = new Map()

	let repoCursors: string[] = []

	let hasNextPage = false;
	let repoCursor = null;

	do {
		const response = await queryRepositories(config.targetOrganisation, null) as OrgRepos

		for (const repo of response.organization.repositories.edges) {
			repoCursors.push(repo.cursor)
		}

		hasNextPage = response?.organization?.repositories?.pageInfo?.hasNextPage
		if (hasNextPage) {
			repoCursor = response?.organization?.repositories?.pageInfo?.endCursor

		}

		const remaining = response.rateLimit.remaining
		const resetDate = new Date(response.rateLimit.resetAt)

		if (remaining < MINIMUM_GITHUB_POINTS) {
			// use absolute, because the are cases in which the reset date could be behind current date (now) 
			const diff_seconds = Math.abs(resetDate.getTime() - Date.now()) / (1000)

			throw new Error(`Rate limit reached. Waiting ${diff_seconds} seconds.`)
		}


	} while (hasNextPage)
	// overwrite the first value to null so that we get the first
	repoCursors[0] = null
	repoCursor = null;
	hasNextPage = false;

	//this is just for waiting, we will only use successfullResponses and failedResponses
    let allPromises: Promise<void>[] = []
	let successfullResponses: GraphResponse[] = []
	let failedResponses: string[] = []

	const numOfPages = 3
	for (let curCursor = 0; curCursor < repoCursors.length; curCursor += numOfPages) {
		const dependencyResponse = queryDependencies(config.targetOrganisation, numOfPages, repoCursors[curCursor]) as Promise<GraphResponse>

		//curCursor must be copied into a const otherwise its value will change by the time the promise is resolved
		const curCursorCopy = curCursor;
		
		allPromises.push(dependencyResponse
			.then((r) => {
				successfullResponses.push(r)
			})
			.catch(e => {
				failedResponses.push(repoCursors[curCursorCopy])
				console.log(`Unexpected error: ${e}`)
			}))

	}
	console.log("Fetched all repositories cursors");
	
	await Promise.all(allPromises);

	if(failedResponses.length > 0) {
		//TODO: ???
		console.log(`Failed to fetch ${failedResponses.length} repositories`)
	}

	for (const response of successfullResponses) {

		for (const repo of response?.organization?.repositories?.edges) {
			const ref = repo.node.mainBranch ? repo.node.mainBranch : repo.node.masterBranch;
			if (ref == null) {
				continue
			}

			const depGraphManifests = ref.repository.dependencyGraphManifests;
			const files: any[] = depGraphManifests.edges;

			console.log(ref.repository.name)

			//This requires files to be sorted by depth, shallowest first
			for (const file of files) {
				const blobPath = file.node.blobPath;
				console.log(blobPath)
			}
		}

		const repoList = getRepos(response);
		const allRepoDeps = getAllRepoDeps(repoList);

		for (const repo of allRepoDeps) {
			const name = repo.manifest.name

			for (const [packageManager, depList] of repo.packageMap) {
				for (const subRepo of depList) {
					let deps: Map<string, string> = new Map();

					for (const dep of subRepo.dependencies) {
						deps.set(dep.packageName, dep.requirements)
					}

					let rep: Repository = {
						name: name + "(" + subRepo.subPath + ")",
						version: subRepo.version,
						link: repo.manifest.url,
						isArchived: repo.manifest.isArchived,
						dependencies: deps
					}

					if (!allDeps.has(packageManager)) {
						allDeps.set(packageManager, [])
					}
					allDeps.get(packageManager).push(rep)
				}
			}
		}

		// hasNextPage = response?.organization?.repositories?.pageInfo?.hasNextPage
		// if (hasNextPage) {
		// 	repoCursor = response?.organization?.repositories?.pageInfo?.endCursor
		// }
	}

	return allDeps
}

//Main function
async function main() {
	const accessToken = getAccessToken()
	const config = loadConfig()

	console.log("Configuration:")
	console.log(config)
	console.log(config.targetOrganisation)

	const rateLimiter: PackageRateLimiter = {
		npm: { tokenBucket: new TokenBucket(1000, APIParameters.npm.rateLimit, APIParameters.npm.intialTokens) },
		pypi: { tokenBucket: new TokenBucket(1000, APIParameters.pypi.rateLimit, APIParameters.pypi.intialTokens) },
	};

	const startTime = Date.now();

	// ==== START: Extracting dependencies from Github graphql response === //

	const allDeps = await scrapeOrganisation(config, accessToken)

	// allDeps: list of dependencies to be given to package APIs
	const packageDeps = mergeDependenciesLists(allDeps);

	const npmDepDataMap = packageDeps.has("NPM") ? await getDependenciesNpm(packageDeps.get("NPM"), rateLimiter) : null;
	console.log("Finished npm. Size: " + npmDepDataMap?.size)
	const pypiDepDataMap = packageDeps.has("PYPI") ? await getDependenciesPyPI(packageDeps.get("PYPI"), rateLimiter) : null;
	console.log("Finished PyPI. Size: " + pypiDepDataMap?.size)

	//Wait for all requests to finish
	console.log("Waiting for all requests to finish");
	await Promise.all([
		//rateLimiter.Github.tokenBucket.waitForShorterQueue(100),
		rateLimiter.npm.tokenBucket.waitForShorterQueue(100),
	]);

	//Print the total time
	const endTime = Date.now();
	console.log("Total time: " + ((endTime - startTime) / 1000).toString())

	let jsonResult: string = ""

	jsonResult += "{"
	jsonResult += "\"npm\": ["
	jsonResult += !allDeps.has("NPM") ? "" : generateDependencyTree(allDeps.get("NPM"), npmDepDataMap)
	jsonResult += "], "
	jsonResult += "\"PyPI\": ["
	jsonResult += !allDeps.has("PYPI") ? "" : generateDependencyTree(allDeps.get("PYPI"), pypiDepDataMap)
	jsonResult += "]"
	jsonResult += "}"

	writeFile("cachedData.json", jsonResult);
}

main();
