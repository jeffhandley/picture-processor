import { argv } from 'yargs';
import fs, { renameSync } from 'fs';
import path from 'path';
import mkdirp from 'mkdirp';
import moment from 'moment';
import { ExifImage } from 'exif';
import { parse } from 'exif-date';
import { copySync, moveSync, pathExists, pathExistsSync } from 'fs-extra';

const src = argv.s || argv.src || argv.source;
const recursive = !!(argv.r || argv.recurse || argv.recursive);
const noop = !!(argv.noop);
const suffix = argv.suffix ? ('-' + argv.suffix) : '';

const pictureDir = argv.copypictures || argv.movepictures;
const pictureNameFormat = argv.picture || 'YYYY/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD-HH-mm-ss';
const pictureSuffix = argv.picturesuffix ? ('-' + argv.picturesuffix) : suffix;
const movePicture = !!(argv.movepictures);

const movieDir = argv.copymovies || argv.movemovies;
const movieNameFormat = argv.movie || 'YYYY-MM-DD-HH-mm-ss';
const movieSuffix = argv.moviesuffix ? ('-' + argv.moviesuffix) : suffix;
const moveMovie = !!(argv.movemovies);

if (!src || !fs.statSync(src).isDirectory()) {
    console.log('You must specify --src as the path to a directory');
    process.exit(1);
}

const pictures = !!pictureDir && {
    dest: pictureDir,
    nameFormat: pictureNameFormat,
    suffix: pictureSuffix,
    moveFile: movePicture
};

const movies = !!movieDir && {
    dest: movieDir,
    nameFormat: movieNameFormat,
    suffix: movieSuffix,
    moveFile: moveMovie
};

function processDirectory(srcDirectory, recurse, noop, pictures, movies, progress) {
    progress.directoriesTotal += 1;
    showProgress(progress);

    console.log(`# Processing ${srcDirectory}${recursive && ', recursively'}`);

    fs.readdir(srcDirectory, (dirErr, files) => {
        files.forEach((file) => {
            if (isIgnored(file)) {
                return;
            }

            const filePath = path.join(srcDirectory, file);

            fs.stat(filePath, (statErr, stats) => {
                if (statErr) {
                    console.warn(`Error processing ${filePath}\n${statErr}`);
                } else if (stats) {
                    if (stats.isDirectory()) {
                        if (recurse) {
                            processDirectory(filePath, recurse, noop, pictures, movies, progress);
                        }
                    } else if (stats.isFile()) {
                        switch (path.extname(filePath).toLowerCase()) {
                            case '.jpg':
                            case '.jpeg':
                                pictures && processJpeg(filePath, pictures, noop, progress);
                                break;

                            case '.gif':
                                pictures && processGenericPicture(filePath, pictures, noop, progress);
                                break;

                            case '.mov':
                            case '.avi':
                            case '.3gp':
                            case '.mp4':
                                movies && processMovie(filePath, movies, noop, progress);
                                break;

                            default:
                                console.log(`# Unrecognized file type for ${filePath}`);
                        }
                    }
                }
            });
        });

        progress.directoriesDone += 1;
        showProgress(progress);
    });
}

function processJpeg(image, target, noop, progress) {
    if (progress.picturesTotal - progress.picturesDone > 10) {
        progress.picturesWaiting += 1;

        return setTimeout(() => {
            progress.picturesWaiting -= 1;
            processJpeg(image, target, noop, progress);
        }, 100);
    }

    progress.picturesTotal += 1;
    showProgress(progress);

    console.log(`# Processing jpeg file ${image}`);

    const done = () => {
        progress.picturesDone += 1;
        showProgress(progress);
    };

    new ExifImage({ image }, (imageErr, exifData) => {
        if (imageErr) {
            console.warn(`Error processing EXIF data for ${image}.\n${imageErr}\n\nUsing file creation date.`);

            return processGenericPicture(image, target, noop, done);
        }

        const { DateTimeOriginal } = exifData.exif;
        const parsedDate = parse(DateTimeOriginal);

        copyFile(image, parsedDate, target, noop, done);
    });
}

function processGenericPicture(picture, target, noop, progress) {
    progress.picturesTotal += 1;
    showProgress(progress);

    const done = () => {
        progress.picturesDone += 1;
        showProgress(progress);
    };

    fs.stat(picture, (statErr, stats) => {
        if (statErr) {
            console.warn(`Error processing file ${picture}.\n${statErr}`);
            return done(statErr);
        }

        const { birthtime } = stats;
        copyFile(picture, birthtime, target, noop, done);
    });
}

function processMovie(movie, target, noop, progress) {
    progress.moviesTotal += 1;
    showProgress(progress);

    const done = () => {
        progress.moviesDone += 1;
        showProgress(progress);
    };

    fs.stat(movie, (statErr, stats) => {
        if (statErr) {
            console.warn(`Error processing movie ${movie}.\n${statErr}`);
            return done(statErr);
        }

        const { birthtime } = stats;

        console.log(`# Processing movie file ${movie}`);
        copyFile(movie, birthtime, target, noop, done);
    });
}

function copyFile(filePath, timestamp, { dest, nameFormat, suffix, moveFile }, noop, callback) {
    const ext = path.extname(filePath).toLowerCase();
    const destFileName = moment(timestamp).format(nameFormat) + suffix + ext;
    const destFilePath = path.join(dest, destFileName);
    const destFileDir = path.dirname(destFilePath);

    mkdirp(destFileDir, (mkdirpErr) => {
        pathExists(destFilePath, (pathExistsErr, exists) => {
            if (exists) {
                console.log(`# ${destFilePath} exists. Skipping.`);
                callback();
            } else {
                const operation = moveFile ? renameOrMoveSync : copySync;
                const operationName = moveFile ? `mv` : 'cp';

                console.log(`${operationName} "${filePath}" "${destFilePath}"`);

                if (!noop) {
                    try {
                        operation(filePath, destFilePath);

                        console.log(`# ${operationName} ${destFilePath} complete.`);
                        callback();
                    } catch (copyErr) {
                        console.log(`# Error ${operationName} ${destFilePath}.\n${copyErr}`);
                        callback(copyErr);
                    }
                } else {
                    callback();
                }
            }
        });
    });
}

function renameOrMoveSync(source, destination) {
    try {
        renameSync(source, destination);
    } catch (renameErr) {
        moveSync(source, destination);
    }
}

function isIgnored(file) {
    const name = path.basename(file).toLowerCase();

    switch (name) {
        case '.ds_store':
        case 'thumbs.db':
        case 'zbthumbnail.info':
            return true;
    }

    const ext = path.extname(file).toLowerCase();

    switch (ext) {
        case '.thm':
            return true;
    }

    return false;
}

recursive && console.log('# Using recursive mode');

const progress = {
    directoriesTotal: 0,
    directoriesDone: 0,
    picturesTotal: 0,
    picturesWaiting: 0,
    picturesDone: 0,
    moviesTotal: 0,
    moviesDone: 0
};

function showProgress({ directoriesDone, directoriesTotal, picturesDone, picturesWaiting, picturesTotal, moviesDone, moviesTotal }) {
    directoriesTotal && console.log(`# Directories: ${directoriesDone} / ${directoriesTotal}`);
    (picturesTotal || picturesWaiting) && console.log(`# Pictures:    ${picturesDone} / ${picturesTotal + picturesWaiting} (${picturesWaiting} waiting)`);
    moviesTotal && console.log(`# Movies:      ${moviesDone} / ${moviesTotal}`);
}

processDirectory(src, recursive, noop, pictures, movies, progress);
