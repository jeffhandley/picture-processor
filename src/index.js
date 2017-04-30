import { argv } from 'yargs';
import fs from 'fs';
import path from 'path';
import mkdirp from 'mkdirp';
import moment from 'moment';
import { ExifImage } from 'exif';
import { parse } from 'exif-date';
import { copy, move, pathExistsSync } from 'fs-extra';

const src = argv.s || argv.src || argv.source;
const recursive = !!(argv.r || argv.recurse || argv.recursive);

const pictureDir = argv.pictures;
const pictureNameFormat = argv.picture || 'YYYY/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD-HH-mm-ss';
const movePicture = !!(argv.movepicture);

const movieDir = argv.movies;
const movieNameFormat = argv.movie || 'YYYY-MM-DD-HH-mm-ss';
const moveMovie = !!(argv.movemovie);


if (!src || !fs.statSync(src).isDirectory()) {
    console.log('You must specify --src as the path to a directory');
    process.exit(1);
}

if (!pictureDir || !pathExistsSync(pictureDir) || !fs.statSync(pictureDir).isDirectory()) {
    console.log('You must specify --pictures as the path to a directory');
    process.exit(1);
}

if (!movieDir || !pathExistsSync(movieDir) || !fs.statSync(movieDir).isDirectory()) {
    console.log('You must specify --movies as the path to a directory');
    process.exit(1);
}

const pictures = {
    dest: pictureDir,
    nameFormat: pictureNameFormat,
    moveFile: movePicture
};

const movies = {
    dest: movieDir,
    nameFormat: movieNameFormat,
    moveFile: moveMovie
};

function processDirectory(srcDirectory, recurse, pictures, movies) {
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
                            processDirectory(filePath, recurse, pictures, movies);
                        }
                    } else if (stats.isFile()) {
                        switch (path.extname(filePath).toLowerCase()) {
                            case '.jpg':
                            case '.jpeg':
                                processJpeg(filePath, pictures);
                                break;

                            case '.gif':
                                processGenericPicture(filePath, pictures);
                                break;

                            case '.mov':
                            case '.avi':
                            case '.3gp':
                            case '.mp4':
                                processMovie(filePath, movies);
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

function processJpeg(image, { dest, nameFormat, moveFile }) {
    console.log(`Processing jpeg file ${image}`);

    new ExifImage({ image }, (imageErr, { exif }) => {
        if (imageErr) {
            console.warn(`Error processing EXIF data for ${image}.\n${imageErr}\n\nUsing file creation date.`);

            return processGenericPicture(image, dest, nameFormat);
        }

        const { DateTimeOriginal } = exif;
        const parsedDate = parse(DateTimeOriginal);

        copyFile(image, parsedDate, dest, nameFormat);
    });
}

function processGenericPicture(picture, { dest, nameFormat, moveFile }) {
    fs.stat(picture, (statErr, stats) => {
        if (statErr) {
            console.warn(`Error processing file ${picture}.\n${statErr}`);
            return;
        }

        const { birthtime } = stats;
        copyFile(picture, birthtime, dest, nameFormat);
    });
}

function processMovie(movie, { dest, nameFormat, moveFile }) {
    console.log(`Processing movie file ${movie}`);

    fs.stat(movie, (statErr, stats) => {
        if (statErr) {
            console.warn(`Error processing movie ${movie}.\n${statErr}`);
            return;
        }

        const { birthtime } = stats;
        copyFile(movie, birthtime, dest, nameFormat);
    });
}

function copyFile(filePath, timestamp, dest, nameFormat, moveFile) {
    const ext = path.extname(filePath).toLowerCase();
    const destFileName = moment(timestamp).format(nameFormat) + ext;
    const destFilePath = path.join(dest, destFileName);
    const destFileDir = path.dirname(destFilePath);

    mkdirp(destFileDir, (mkdirpErr) => {
        pathExistsSync(destFilePath, (exists) => {
            if (exists) {
                console.log(`${destFilePath} exists. Skipping.`);
            } else {
                const operation = moveFile ? move : copy;
                const operationName = moveFile ? 'moving' : 'copying';

                console.log(`${operationName} ${destFilePath}`);

                operation(filePath, destFilePath, (copyErr) => {
                    if (copyErr) {
                        console.log(`Error ${operationName} ${destFilePath}.\n${copyErr}`);
                    } else {
                        console.log(`${operationName} ${destFilePath} complete.`);
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

processDirectory(src, recursive, pictures, movies);
