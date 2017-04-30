import { argv } from 'yargs';
import fs from 'fs';
import { ExifImage } from 'exif';

const src = argv.s || argv.src || argv.source;
const dest = argv.d || argv.dest || argv.destination;
const recursive = !!(argv.r || argv.recurse || argv.recursive);

if (!src || !fs.statSync(src).isDirectory()) {
    console.log('You must specify --src as the path to a directory');
    process.exit(1);
}

function processDirectory(directory) {
    fs.readdir(src, (err, files) => {
        files.forEach((file) => {
            console.log(`Processing ${file}`);

            fs.stat(file, (err, stats) => {
                if (stats && stats.isDirectory()) {
                    if (recursive) {
                        processDirectory(file);
                    }
                }
            });
        });
    });
}

processDirectory(src);
