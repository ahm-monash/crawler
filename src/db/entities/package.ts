
/**
 * PackageType tells wether the package is internal or external
 */
export const enum PackageType {
	Internal = "internal",
	External = "external"
} 

/**
 * PackageLanguage tells wether the package is written in javascript or typescript
 */
export const enum PackageLanguage {
	JavaScript = "js",
	TypeScript = "ts"
}

/**
 * A Package represents a nodejs package.
 */
export interface Package {
    id: number
    name: string
	description: string
	nodeVersion: string
    internal: boolean
	lang: PackageLanguage
	version: string
	repoUrl: string
	npmUrl: string
	lastUpdated: Date
	lastCrawled: Date
}