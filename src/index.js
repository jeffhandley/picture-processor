import { argv } from 'yargs';
import fs from 'fs';
import path from 'path';
import mkdirp from 'mkdirp';
import moment from 'moment';
import { ExifImage } from 'exif';
import { parse } from 'exif-date';
import { copy } from 'fs-extra';

const src = argv.s || argv.src || argv.source;
const pictureDir = argv.pictures;
const movieDir = argv.movies;
const recursive = !!(argv.r || argv.recurse || argv.recursive);
const pictureNameFormat = argv.picture || 'YYYY/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD-HH-mm-ss';
const movieNameFormat = argv.movie || 'YYYY-MM-DD-HH-mm-ss';

if (!src || !fs.statSync(src).isDirectory()) {
    console.log('You must specify --src as the path to a directory');
    process.exit(1);
}

if (!pictureDir || !fs.existsSync(pictureDir) || !fs.statSync(pictureDir).isDirectory()) {
    console.log('You must specify --pictures as the path to a directory');
    process.exit(1);
}

if (!movieDir || !fs.existsSync(movieDir) || !fs.statSync(movieDir).isDirectory()) {
    console.log('You must specify --movies as the path to a directory');
    process.exit(1);
}

function processDirectory(srcDirectory, recurse, pictureDir, movieDir, pictureNameFormat, movieNameFormat) {
    console.log(`Processing ${srcDirectory}${recursive && ', recursively'}`);

    fs.readdir(srcDirectory, (dirErr, files) => {
        files.forEach((file) => {
            if (isIgnored(file)) {
                return;
            }

            const filePath = path.join(srcDirectory, file);
            console.log(`Processing ${filePath}`);

            fs.stat(filePath, (statErr, stats) => {
                if (statErr) {
                    console.warn(`Error processing ${filePath}\n${statErr}`);
                } else if (stats) {
                    if (stats.isDirectory()) {
                        if (recurse) {
                            processDirectory(filePath, recurse, pictureDir, movieDir, pictureNameFormat, movieNameFormat);
                        }
                    } else if (stats.isFile()) {
                        switch (path.extname(filePath).toLowerCase()) {
                            case '.jpg':
                            case '.jpeg':
                                processJpeg(filePath, pictureDir, pictureNameFormat);
                                break;

                            case '.mov':
                            case '.avi':
                            case '.3gp':
                            case '.mp4':
                                processMovie(filePath, movieDir, movieNameFormat);
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

function processJpeg(image, destDirectory, filenameFormat) {
    console.log(`Processing jpeg file ${image}`);

    new ExifImage({ image }, (imageErr, { exif }) => {
        if (imageErr) {
            console.warn(`Error processing EXIF data for ${image}.\n${imageErr}\n\nUsing file creation date.`);

            fs.stat(image, (statErr, stats) => {
                if (statErr) {
                    console.warn(`Error processing file ${image}.\n${statErr}`);
                    return;
                }

                const { birthtime } = stats;
                copyFile(image, birthtime, destDirectory, filenameFormat);
            });

            return;
        }

        const { DateTimeOriginal } = exif;
        const parsedDate = parse(DateTimeOriginal);

        copyFile(image, parsedDate, destDirectory, filenameFormat);
    });
}

function processMovie(movie, destDirectory, filenameFormat) {
    console.log(`Processing movie file ${movie}`);

    fs.stat(movie, (statErr, stats) => {
        if (statErr) {
            console.warn(`Error processing movie ${movie}.\n${statErr}`);
            return;
        }

        const { birthtime } = stats;
        copyFile(movie, birthtime, destDirectory, filenameFormat);
    });
}

function copyFile(filePath, timestamp, destDirectory, filenameFormat) {
    const ext = path.extname(filePath).toLowerCase();
    const destFileName = moment(timestamp).format(filenameFormat) + ext;
    const destFilePath = path.join(destDirectory, destFileName);
    const destFileDir = path.dirname(destFilePath);

    mkdirp(destFileDir, (mkdirpErr) => {
        fs.exists(destFilePath, (exists) => {
            if (exists) {
                console.log(`${destFilePath} exists. Skipping.`);
            } else {
                copy(filePath, destFilePath, (copyErr) => {
                    if (copyErr) {
                        console.log(`Error creating ${destFilePath}.\n${copyErr}`);
                    } else {
                        console.log(`Created ${destFilePath}`);
                    }
                });
            }
        });
    });
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

recursive && console.log('Using recursive mode');

processDirectory(src, recursive, pictureDir, movieDir, pictureNameFormat, movieNameFormat);
