import { fromPath } from 'pdf2pic';
import * as path from 'path'
import * as fs from 'fs'
import { Blob, Buffer } from 'buffer';
import { ToBase64Response } from 'pdf2pic/dist/types/toBase64Response'
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { fileURLToPath } from 'url';
import QRCode, { toString } from 'qrcode';

import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

import * as http from 'http';
import * as url from 'url';
import { time } from 'console';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

initializeApp({
    credential: cert(path.resolve(__dirname, './adminsdk.json')),
    storageBucket: "qrhamsters-app.appspot.com"
})

const bucket = getStorage().bucket();

async function clearTemp(): Promise<void> {
    const dir = path.join(__dirname, './temp/');
    fs.readdir(dir, (err, files) => {
        if (err) throw err;
      
        for (const file of files) {
          fs.unlink(path.join(dir, file), err => {
            if (err) throw err;
          });
        }
      });
}

async function downloadLatestFile(userID: string): Promise<string | null> {
    const [files] = await bucket.getFiles({prefix: `users/${userID}/pdf`})

    let maxTimestamp = -1;
    let selectedFile = undefined;
    for (const file of files) {
        const fileTimestamp = parseInt(file.name.replace(`users/${userID}/pdf/`, ''));
        if (fileTimestamp > maxTimestamp) {
            selectedFile = file;
            maxTimestamp = fileTimestamp;
        }
    }
    if (selectedFile === undefined) {
        return null;
    }
    await selectedFile.download({destination: path.resolve(__dirname, `./temp/${maxTimestamp}.pdf`)});
    return maxTimestamp.toString();
}


async function uploadQR(userID: string, timestamp: string): Promise<string> {
    const pdfTicketPath = path.resolve(__dirname, './temp/', `${timestamp}.pdf`);
    const base64image = await fromPath(pdfTicketPath, {
        format: 'png',
        quality: 100,
    })(1, true) as ToBase64Response;

    const dataUri = base64image?.base64;
    if (dataUri === undefined || base64image.size == '0') {
        throw(new Error('Could not extract image base64'));
    }

    const buffer = Buffer.from(dataUri, 'base64');
    const png = PNG.sync.read(buffer);

    const qr = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
    if (qr === null) {
        throw(new Error('Could not scan qr code'));
    }
    const qrPath = path.resolve(__dirname, 'temp/qr.png')
    await QRCode.toFile(qrPath, qr.data);
    const resp = await bucket.upload(qrPath, {
        destination: `users/${userID}/qr/${timestamp}_${qr.data}.png`,
        metadata: {contentType: 'image/png'}
    });
    return (resp[0].metadata.mediaLink);
}

async function createNftMetadata(userId: string, timestamp: string, mediaLink: string): Promise<void>{
    const metadata = {
        name: `H4V  ticket #${timestamp}`,
        description: 'Hack4Vilnius event ticket',
        image_url: mediaLink,
    }

    const uploadStr = JSON.stringify(metadata);
    const filePath = path.resolve(__dirname, `temp/${timestamp}.json`);
    fs.writeFile(filePath, uploadStr, {encoding: 'utf8'}, () => {});
    const resp = await bucket.upload(filePath, {
        destination: `users/${userId}/nfts/${timestamp}.json`,
        metadata: {contentType: 'text/json'},
    })
}

async function main(userId: string) {
    await clearTemp();
    const timestamp = await downloadLatestFile(userId);
    if (timestamp === null) {
        console.log('No pdf files found');
        return;
    }
    const mediaLink = await uploadQR(userId, timestamp);
    await createNftMetadata(userId, timestamp, mediaLink);
}

const requestListener = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const queryObject = url.parse(req.url as string, true).query;
    if (queryObject['userId'] === undefined) {
        res.writeHead(400, {'Content-Type': 'json'});
        res.end("{'error': 'missing userId param'}");
        return;
    }

    const userId = queryObject.userId as string;
    await main(userId);

    res.writeHead(200, {'Content-Type': 'json'});
    res.end("{'success': 'QR created'}");
}

http.createServer(requestListener).listen(5050);
//run command
//node --trace-warnings --experimental-modules --loader ts-node/esm ./backend/src/main.ts 








