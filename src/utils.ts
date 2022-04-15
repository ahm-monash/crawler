import * as fs from "fs";
import * as inquier from "inquirer";

//Read the "access_token.txt" file to grab the accesstoken.
export function getAccessToken(): string {
	try {
		return fs.readFileSync("access_token.txt").toString();
	} catch (e) {
		let processedAns: string
		while (true) {
			inquier.prompt(
				["access_token.txt file not found. Do you want to continue without one? (Yes)/No:"]
			).then(
				(ans) => { processedAns = (ans as string).toLowerCase().trim() }
			);

			if (["no", "n"].includes(processedAns)) {
				throw new Error("access_token.txt file not found")
			} else if(["yes", "y", ""].includes(processedAns)){
				return ""
			}
		}
	}
}

export async function sleep(millis: number) {
	return new Promise(resolve => setTimeout(resolve, millis));
}