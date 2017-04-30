import { argv } from 'yargs';
import fs from 'fs';
import path from 'path';
import { ExifImage } from 'exif';

const src = argv.s || argv.src || argv.source;
const dest = argv.d || argv.dest || argv.destination;
const recursive = !!(argv.r || argv.recurse || argv.recursive);

if (!src || !fs.statSync(src).isDirectory()) {
    console.log('You must specify --src as the path to a directory');
    process.exit(1);
}

function processDirectory(directory, recurse) {
    console.log(`Processing ${directory}${recursive && ', recursively'}`);

    fs.readdir(directory, (dirErr, files) => {
        files.forEach((file) => {
            if (isIgnored(file)) {
                return;
            }

            const filePath = path.join(directory, file);
            console.log(`Processing ${filePath}`);

            fs.stat(filePath, (statErr, stats) => {
                if (stats) {
                    if (stats.isDirectory()) {
                        if (recurse) {
                            processDirectory(filePath);
                        }
                    } else if (stats.isFile()) {
                        switch (path.extname(filePath).toLowerCase()) {
                            case '.jpg':
                            case '.jpeg':
                                processJpeg(filePath);
                                break;

                            case '.mov':
                                processMovie(filePath);
                                break;

                            default:
                                console.log(`Unrecognized file type for ${filePath}`);
                        }
                    }
                }
            });
        });
    });
}

function processJpeg(filePath) {
    console.log(`Processing jpeg file ${filePath}`);
}

function processMovie(filePath) {
    console.log(`Processing movie file ${filePath}`);
}

function isIgnored(file) {
    if (path.basename(file).toLowerCase() === '.ds_store') {
        return true;
    }

    if (path.extname(file).toLowerCase() === '.thm') {
        return true;
    }

    return false;
}

recursive && console.log('Using recursive mode')

processDirectory(src, recursive);
