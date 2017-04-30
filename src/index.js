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
const label = argv.label ? ('-' + argv.label) : '';

const pictureDir = argv.copypictures || argv.movepictures;
const pictureNameFormat = argv.picture || 'YYYY/YYYY-MM/YYYY-MM-DD/YYYY-MM-DD-HH-mm-ss';
const pictureLabel = argv.picturelabel ? ('-' + argv.picturelabel) : label;
const movePicture = !!(argv.movepictures);

const movieDir = argv.copymovies || argv.movemovies;
const movieNameFormat = argv.movie || 'YYYY-MM-DD-HH-mm-ss';
const movieLabel = argv.movielabel ? ('-' + argv.movielabel) : label;
const moveMovie = !!(argv.movemovies);

const otherDir = argv.copyothers || argv.moveothers;
const otherNameFormat = argv.other || 'YYYY-MM-DD-HH-mm-ss';
const otherLabel = argv.otherlabel ? ('-' + argv.otherlabel) : label;
const moveOther = !!(argv.moveothers);

if (!src || !fs.statSync(src).isDirectory()) {
    console.error('You must specify --src as the path to a directory');
    process.exit(1);
}

const pictures = !!pictureDir && {
    dest: pictureDir,
    nameFormat: pictureNameFormat,
    label: pictureLabel,
    moveFile: movePicture
};

const movies = !!movieDir && {
    dest: movieDir,
    nameFormat: movieNameFormat,
    label: movieLabel,
    moveFile: moveMovie
};

const others = !!otherDir && {
    dest: otherDir,
    nameFormat: otherNameFormat,
    label: otherLabel,
    moveFile: moveOther
};

function processDirectory(srcDirectory, recurse, noop, pictures, movies, others, progress) {
    progress.directoriesTotal += 1;
    showProgress(progress);

    const done = () => {
        showProgress(progress);
    };

    console.log(`# Processing ${srcDirectory}${recursive && ', recursively'}`);

    fs.readdir(srcDirectory, (dirErr, files) => {
        files.forEach((file) => {
            if (isIgnored(file)) {
                return;
            }

            const filePath = path.join(srcDirectory, file);

            fs.stat(filePath, (statErr, stats) => {
                if (statErr) {
                    console.warn(`# Error processing ${filePath}\n${statErr}`);
                } else if (stats) {
                    if (stats.isDirectory()) {
                        if (recurse) {
                            processDirectory(filePath, recurse, noop, pictures, movies, others, progress, done);
                        }
                    } else if (stats.isFile()) {
                        switch (path.extname(filePath).toLowerCase()) {
                            case '.jpg':
                            case '.jpeg':
                                pictures && processJpeg(filePath, pictures, noop, progress, done);
                                break;

                            case '.gif':
                                pictures && processFile(filePath, pictures, noop, progress, done);
                                break;

                            case '.mov':
                            case '.avi':
                            case '.3gp':
                            case '.mp4':
                                movies && processMovie(filePath, movies, noop, progress, done);
                                break;

                            default:
                                if (others) {
                                    processFile(filePath, others, noop, progress, done);
                                } else {
                                    console.warn(`# Unrecognized file type for ${filePath}`);
                                }
                        }
                    }
                }
            });
        });

        progress.directoriesDone += 1;
        showProgress(progress);
    });
}

function processJpeg(image, target, noop, progress, callback) {
    if (progress.picturesTotal - progress.picturesDone > 10) {
        progress.picturesWaiting += 1;

        if (progress.picturesWaiting > progress.picturesWaitingReported) {
            progress.picturesWaitingReported = progress.picturesWaiting;
            showProgress(progress);
        }

        return setTimeout(() => {
            progress.picturesWaiting -= 1;
            processJpeg(image, target, noop, progress);
        }, 100);
    }

    const done = () => {
        progress.picturesDone += 1;
        showProgress(progress);
        callback();
    };

    console.log(`# Loading ${image}`);

    progress.picturesTotal += 1;
    showProgress(progress);

    new ExifImage({ image }, (imageErr, exifData) => {
        if (imageErr) {
            console.warn(`# Error processing EXIF data for ${image}.\n${imageErr}\n\nUsing file creation date.`);

            return processFile(image, target, noop, progress, done);
        }

        const { DateTimeOriginal } = exifData.exif;
        const parsedDate = parse(DateTimeOriginal);

        copyFile(image, parsedDate, target, noop, done);
    });
}

function processFile(file, target, noop, progress, callback) {
    progress.othersTotal += 1;
    showProgress(progress);

    const done = () => {
        progress.othersDone += 1;
        showProgress(progress);

        if (callback) {
            callback();
        }
    };

    fs.stat(file, (statErr, stats) => {
        if (statErr) {
            console.warn(`# Error processing file ${file}.\n${statErr}`);
            return done(statErr);
        }

        const { birthtime } = stats;
        copyFile(file, birthtime, target, noop, done);
    });
}

function processMovie(movie, target, noop, progress, callback) {
    progress.moviesTotal += 1;
    showProgress(progress);

    const done = () => {
        progress.moviesDone += 1;
        showProgress(progress);
        callback();
    };

    const stats = fs.statSync(movie);
    const { birthtime } = stats;

    copyFile(movie, birthtime, target, noop, done);
}

function copyFile(filePath, timestamp, { dest, nameFormat, label, moveFile }, noop, callback) {
    const ext = path.extname(filePath).toLowerCase();
    const destFileName = moment(timestamp).format(nameFormat) + label + ext;
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
                        callback();
                    } catch (copyErr) {
                        console.warn(`# Error ${operationName} ${destFilePath}.\n${copyErr}`);
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
    picturesWaitingReported: 0,
    picturesDone: 0,
    moviesTotal: 0,
    moviesDone: 0,
    othersTotal: 0,
    othersDone: 0
};

function showProgress({ directoriesDone, directoriesTotal, picturesDone, picturesWaiting, picturesTotal, moviesDone, moviesTotal, othersTotal, othersDone }) {
    console.log('# ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^');
    console.log(`# Directories: ${directoriesDone} / ${directoriesTotal}`);
    (picturesTotal || picturesWaiting) && console.log(`# Pictures:    ${picturesDone} / ${picturesTotal + picturesWaiting}${picturesWaiting && ` (${picturesWaiting} waiting)`}`);
    moviesTotal && console.log(`# Movies:      ${moviesDone} / ${moviesTotal}`);
    othersTotal && console.log(`# Others:      ${othersDone} / ${othersTotal}`);
    console.log('# vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv');
}

processDirectory(src, recursive, noop, pictures, movies, others, progress);
