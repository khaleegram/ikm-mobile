import { Project } from 'ts-morph';
import fs from 'fs';

const project = new Project();
const sourceFile = project.addSourceFileAtPath('src/index.ts');

const exportsList = [];
for (const stmt of sourceFile.getStatements()) {
    const comments = stmt.getLeadingCommentRanges().map(c => c.getText()).join('\n');
    let isExported = false;
    let name = '';
    
    // Check VariableStatement
    if (stmt.getKindName() === 'VariableStatement') {
        const isExp = stmt.hasModifier('export');
        if (isExp) {
            isExported = true;
            name = stmt.getDeclarations()[0].getName();
        }
    }
    
    // Check FunctionDeclaration
    if (stmt.getKindName() === 'FunctionDeclaration') {
        if (stmt.hasModifier('export')) {
            isExported = true;
            name = stmt.getName();
        }
    }

    if (isExported) {
        let section = 'GENERAL';
        if (comments.includes('PAYMENT')) section = 'PAYMENT';
        else if (comments.includes('ORDER')) section = 'ORDER';
        else if (comments.includes('CHAT')) section = 'CHAT';
        else if (comments.includes('AUTH') || comments.includes('USER')) section = 'USER';
        else if (comments.includes('PRODUCT') || comments.includes('POST')) section = 'POST';
        
        exportsList.push({ name, section, line: stmt.getStartLineNumber() });
    }
}

fs.writeFileSync('exports_list.json', JSON.stringify(exportsList, null, 2));
console.log('Structure extracted successfully.');
