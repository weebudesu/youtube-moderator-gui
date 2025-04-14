// pages/api/youtube/scan.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getToken } from 'next-auth/jwt';
import { getAllChannelVideos, fetchAndFilterSpamComments, deleteComments } from '../../../lib/youtubeLogic';

// State sederhana di memori untuk melacak status (HANYA UNTUK DEMO)
interface ScanStatus {
    isRunning: boolean;
    message: string;
    currentVideo: string;
    videosProcessed: number;
    totalVideos: number;
    spamFound: number;
    spamDeleted: number;
    error: string | null;
    startTime: number | null;
}

let currentScanStatus: ScanStatus = {
    isRunning: false,
    message: 'Idle',
    currentVideo: '',
    videosProcessed: 0,
    totalVideos: 0,
    spamFound: 0,
    spamDeleted: 0,
    error: null,
    startTime: null,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // 1. Dapatkan token JWT (termasuk access token)
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    if (!token || !token.accessToken) {
        return res.status(401).json({ error: 'Unauthorized: No valid token found.' });
    }
     if (token.error === "RefreshAccessTokenError") {
         return res.status(401).json({ error: "Refresh token failed. Please log in again." });
    }


    const accessToken = token.accessToken as string;
    const channelId = process.env.YOUTUBE_CHANNEL_ID;

    if (!channelId) {
        return res.status(500).json({ error: 'YOUTUBE_CHANNEL_ID environment variable is not set.' });
    }

    // 2. Handle GET request untuk status
    if (req.method === 'GET') {
        // Hitung durasi jika sedang berjalan
        let duration = null;
        if (currentScanStatus.isRunning && currentScanStatus.startTime) {
            duration = Math.round((Date.now() - currentScanStatus.startTime) / 1000); // dalam detik
        }
        return res.status(200).json({ ...currentScanStatus, duration });
    }

    // 3. Handle POST request untuk memulai scan
    if (req.method === 'POST') {
        if (currentScanStatus.isRunning) {
            return res.status(409).json({ error: 'Scan is already in progress.' });
        }

        // Reset status dan mulai scan di latar belakang
        currentScanStatus = {
            isRunning: true,
            message: 'Initializing scan...',
            currentVideo: '',
            videosProcessed: 0,
            totalVideos: 0,
            spamFound: 0,
            spamDeleted: 0,
            error: null,
            startTime: Date.now(),
        };

        // Kirim respons cepat ke client bahwa scan dimulai
        res.status(202).json({ message: 'Scan initiated.' });

        // --- Mulai Proses Asinkron ---
        (async () => {
            try {
                const statusCallback = (message: string) => {
                    currentScanStatus.message = message;
                    // console.log(`Scan Status Update: ${message}`); // Log server
                };

                const videos = await getAllChannelVideos(accessToken, channelId, statusCallback);
                currentScanStatus.totalVideos = videos.length;
                statusCallback(`Found ${videos.length} videos. Starting comment analysis...`);

                let totalSpamFound = 0;
                let totalSpamDeleted = 0;

                for (let i = 0; i < videos.length; i++) {
                    const video = videos[i];
                    const videoTitle = video.snippet?.title ?? 'Unknown Title';
                    const videoId = video.snippet?.resourceId?.videoId;

                    currentScanStatus.videosProcessed = i + 1;
                    currentScanStatus.currentVideo = `${videoTitle} (${videoId})`;

                    if (!videoId) {
                        statusCallback(`Skipping item ${i + 1} (no video ID found)`);
                        continue;
                    }

                    statusCallback(`[${i + 1}/${videos.length}] Analyzing comments for: ${videoTitle}`);

                    const spamCommentIds = await fetchAndFilterSpamComments(accessToken, videoId, statusCallback);
                    currentScanStatus.spamFound += spamCommentIds.length;
                    totalSpamFound += spamCommentIds.length;

                    if (spamCommentIds.length > 0) {
                        statusCallback(`[${i + 1}/${videos.length}] Deleting ${spamCommentIds.length} spam comments for: ${videoTitle}`);
                        const deleteResult = await deleteComments(accessToken, spamCommentIds, statusCallback);
                        currentScanStatus.spamDeleted += deleteResult.success;
                        totalSpamDeleted += deleteResult.success;
                    } else {
                         statusCallback(`[${i + 1}/${videos.length}] No spam found for: ${videoTitle}`);
                    }
                }

                currentScanStatus.message = `Scan completed. Processed ${videos.length} videos. Found ${totalSpamFound} spam comments, successfully deleted ${totalSpamDeleted}.`;
                currentScanStatus.currentVideo = ''; // Reset current video

            } catch (error: any) {
                console.error("Error during background scan:", error);
                currentScanStatus.error = error.message || 'An unknown error occurred during the scan.';
                currentScanStatus.message = `Scan failed: ${currentScanStatus.error}`;
            } finally {
                currentScanStatus.isRunning = false; // Tandai selesai (atau gagal)
                console.log(`Scan finished. Final Status: ${currentScanStatus.message}`);
            }
        })();
        // --- Akhir Proses Asinkron ---

        return; // Fungsi handler API selesai di sini
    }

    // Jika bukan GET atau POST
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
}