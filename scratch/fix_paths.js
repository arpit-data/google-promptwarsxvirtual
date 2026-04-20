import fs from 'fs';
import path from 'path';

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory && f !== 'node_modules' && f !== '.git' && f !== 'dist') {
            walk(dirPath, callback);
        } else if (!isDirectory) {
            callback(dirPath);
        }
    });
}

const root = process.cwd();

walk(root, (filePath) => {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('@/')) {
            // Calculate relative path to root
            const relativeToRoot = path.relative(path.dirname(filePath), root);
            const prefix = relativeToRoot === '' ? '.' : relativeToRoot.replace(/\\/g, '/');
            
            // Replace @/ with prefix/
            // Special case: if prefix is '.', replace @/ with ./
            // Otherwise, replace @/ with prefix/
            const replacement = prefix === '.' ? './' : (prefix.endsWith('/') ? prefix : prefix + '/');
            
            console.log(`Processing ${filePath}: replacing @/ with ${replacement}`);
            
            let newContent = content.split('@/').join(replacement);
            fs.writeFileSync(filePath, newContent, 'utf8');
        }
    }
});
