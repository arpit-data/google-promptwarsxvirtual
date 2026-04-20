import fs from 'fs';
import path from 'path';

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walk(dirPath, callback) : callback(path.join(dir, f));
    });
}

const root = process.cwd();
walk(root, (filePath) => {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        if (filePath.includes('node_modules')) return;
        
        let content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('@/')) {
            let newContent = content.split('@/').join('./');
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(`Updated: ${filePath}`);
        }
    }
});
