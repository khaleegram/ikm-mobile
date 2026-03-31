import { Project, SyntaxKind } from 'ts-morph';
import fs from 'fs';
import path from 'path';

const project = new Project({
  tsConfigFilePath: '../../tsconfig.json'
});

// We will extract core functions first to a new file mentally, but here we just leave the core client in a new file.
const cloudFunctionsFile = project.getSourceFileOrThrow('lib/api/cloud-functions.ts');

const classDecl = cloudFunctionsFile.getClassOrThrow('CloudFunctionsClient');
const methods = classDecl.getMethods();

const methodMap = new Map();

methods.forEach(method => {
    if (method.getName() === 'request' || method.getName() === 'getIdToken' || method.getName() === 'getFunctionNameFromUrl' || method.getName() === 'get404FallbackUrl' || method.getName() === 'isExpectedPaymentVerificationState' || method.getName() === 'reportFunctionError') {
        return;
    }
    
    // Get the method text
    let methodText = method.getText();
    // Replace "this.request" with "coreCloudClient.request"
    methodText = methodText.replace(/this\.request/g, 'coreCloudClient.request');
    methodMap.set(method.getName(), methodText);
});

console.log(`Found ${methodMap.size} endpoint methods in CloudFunctionsClient`);

// Actually it's easier to manually write core-cloud-client.ts and then manually distribute 
// the methods. Since this script might fail on edge cases, I will just dump the methods 
// grouped by their domain so I can manually paste them into the respective files, 
// OR I can just map them directly into a few unified domain files and delete cloud-functions.ts.

const output = {};
for (const [name, text] of methodMap.entries()) {
    output[name] = text;
}
fs.writeFileSync('lib/api/methods_dump.json', JSON.stringify(output, null, 2));

console.log('Dumped methods to methods_dump.json');
