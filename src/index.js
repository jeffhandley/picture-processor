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
const dedupe = !!(argv.dedupe);

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

function consoleLog(...params) {
    console.log('#', moment().format('HH:mm:ss'), ...params);
}

function consoleWarn(...params) {
    console.warn('#', moment().format('HH:mm:ss'), ...params);
}

if (!src || !fs.statSync(src).isDirectory()) {
    console.error('You must specify --src as the path to a directory');
    process.exit(1);
}

const pictures = !!pictureDir && {
    dest: pictureDir,
    nameFormat: pictureNameFormat,
    label: pictureLabel,
    dedupe,
    moveFile: movePicture
};

const movies = !!movieDir && {
    dest: movieDir,
    nameFormat: movieNameFormat,
    label: movieLabel,
    dedupe,
    moveFile: moveMovie
};

const others = !!otherDir && {
    dest: otherDir,
    nameFormat: otherNameFormat,
    label: otherLabel,
    dedupe,
    moveFile: moveOther
};

function processDirectory(srcDirectory, recurse, noop, pictures, movies, others, progress) {
    progress.directoriesTotal += 1;
    showProgress(progress);

    const done = () => {
        showProgress(progress);
    };

    consoleLog(`Processing ${srcDirectory}${recursive && ', recursively'}`);

    fs.readdir(srcDirectory, (dirErr, files) => {
        files.forEach((file) => {
            if (isIgnored(file)) {
                return;
            }

            const filePath = path.join(srcDirectory, file);

            fs.stat(filePath, (statErr, stats) => {
                if (statErr) {
                    consoleWarn(`Error processing ${filePath}\n${statErr}`);
                } else if (stats) {
                    if (stats.isDirectory()) {
                        if (recurse) {
                            processDirectory(filePath, recurse, noop, pictures, movies, others, progress);
                        }
                    } else if (stats.isFile()) {
                        switch (path.extname(filePath).toLowerCase()) {
                            case '.jpg':
                            case '.jpeg':
                                pictures && processJpeg(filePath, pictures, noop, progress, done);
                                break;

                            case '.gif':
                            case '.mpo':
                            case '.png':
                            case '.bmp':
                            case '.pdf':
                                pictures && processFile(filePath, pictures, noop, progress, done);
                                break;

                            case '.mov':
                            case '.avi':
                            case '.3gp':
                            case '.mp4':
                            case '.mpg':
                                movies && processMovie(filePath, movies, noop, progress, done);
                                break;

                            default:
                                if (others) {
                                    processFile(filePath, { ...others, label: basename(filePath) }, noop, progress, done);
                                } else {
                                    consoleWarn(`Unrecognized file type for ${filePath}`);
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
            processJpeg(image, target, noop, progress, callback);
        }, 100);
    }

    const done = () => {
        progress.picturesDone += 1;
        showProgress(progress);

        if (!callback) {
            consoleLog('No callback provided to processJpeg');
        } else {
            callback();
        }
    };

    consoleLog(`Loading ${image}`);

    progress.picturesTotal += 1;
    showProgress(progress);

    new ExifImage({ image }, (imageErr, exifData) => {
        if (imageErr) {
            consoleWarn(`Error processing EXIF data for ${image}.\n${imageErr}\n\nUsing file creation date.`);

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

        if (!callback) {
            consoleLog('No callback provided to processFile');
        } else {
            callback();
        }
    };

    fs.stat(file, (statErr, stats) => {
        if (statErr) {
            consoleWarn(`Error processing file ${file}.\n${statErr}`);
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

        if (!callback) {
            consoleLog('No callback provided to processMovie');
        } else {
            callback();
        }
    };

    const stats = fs.statSync(movie);
    const { birthtime } = stats;

    copyFile(movie, birthtime, target, noop, done);
}

function copyFile(filePath, timestamp, { dest, nameFormat, label, dedupe, moveFile }, noop, callback) {
    const ext = path.extname(filePath).toLowerCase();
    const destFileName = moment(timestamp).format(nameFormat) + label + (dedupe >= 2 ? '-' + dedupe : '') + ext;
    const destFilePath = path.join(dest, destFileName);
    const destFileDir = path.dirname(destFilePath);

    const done = (copyFileErr) => {
        if (!callback) {
            consoleLog('No callback provided to copyFile');
        } else {
            callback(copyFileErr);
        }
    };

    mkdirp(destFileDir, (mkdirpErr) => {
        pathExists(destFilePath, (pathExistsErr, exists) => {
            if (exists) {
                if (dedupe) {
                    dedupe += 1;

                    copyFile(filePath, timestamp, {
                        dest,
                        nameFormat,
                        label,
                        dedupe,
                        moveFile
                    }, noop, done);
                } else {
                    consoleLog(`${destFilePath} exists. Skipping.`);
                    done();
                }
            } else {
                const operation = moveFile ? renameOrMoveSync : copySync;
                const operationName = moveFile ? `mv` : 'cp';

                console.log(`${operationName} "${filePath}" "${destFilePath}"`);

                if (!noop) {
                    try {
                        operation(filePath, destFilePath);
                        done();
                    } catch (copyErr) {
                        consoleWarn(`Error ${operationName} ${destFilePath}.\n${copyErr}`);
                        done(copyErr);
                    }
                } else {
                    done();
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

recursive && consoleLog('Using recursive mode');

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
    consoleLog('^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^');
    consoleLog(`Directories: ${directoriesDone} / ${directoriesTotal}`);
    (picturesTotal || picturesWaiting) && consoleLog(`Pictures:    ${picturesDone} / ${picturesTotal + picturesWaiting}${picturesWaiting ? ` (${picturesWaiting} waiting)` : ''}`);
    moviesTotal && consoleLog(`Movies:      ${moviesDone} / ${moviesTotal}`);
    othersTotal && consoleLog(`Others:      ${othersDone} / ${othersTotal}`);
    consoleLog('vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv');
}

processDirectory(src, recursive, noop, pictures, movies, others, progress);
