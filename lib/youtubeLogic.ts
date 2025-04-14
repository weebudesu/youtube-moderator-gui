// lib/youtubeLogic.ts
import { google, youtube_v3 } from 'googleapis';
import fs from 'fs';
import path from 'path';

// Path ke file blockedword.json di root proyek
const blockedWordPath = path.resolve(process.cwd(), 'blockedword.json');
let blockedWords: string[] = [];

// Baca blocked words saat modul dimuat
try {
    const rawData = fs.readFileSync(blockedWordPath, 'utf-8');
    blockedWords = JSON.parse(rawData).map((word: string) => word.toLowerCase());
    console.log(`Loaded ${blockedWords.length} blocked words.`);
} catch (error) {
    console.error("Error loading blockedword.json:", error);
    console.warn("Proceeding with empty blocked words list.");
    blockedWords = []; // Lanjutkan dengan daftar kosong jika file tidak ada atau error
}

// Fungsi untuk mendapatkan instance YouTube API client
function getYoutubeClient(accessToken: string): youtube_v3.Youtube {
  const oAuth2Client = new google.auth.OAuth2();
  oAuth2Client.setCredentials({ access_token: accessToken });
  return google.youtube({ version: 'v3', auth: oAuth2Client });
}

// Fungsi untuk memeriksa komentar spam (mirip dengan kode asli Anda)
function getJudolComment(text: string | null | undefined): boolean {
    if (!text) return false;

    const normalizedText = text.normalize("NFKD");
    const lowerText = normalizedText.toLowerCase();

    // Cek jika normalisasi mengubah teks (mungkin karakter aneh)
    // Perbaikan: Cek jika teks asli *tidak sama* dengan hasil normalisasi
    // if (text !== normalizedText) {
    //     console.log(`Normalization changed text: "${text}" -> "${normalizedText}"`);
    //     return true; // Anggap spam jika normalisasi mengubahnya (opsional)
    // }

    // Cek kata yang diblokir
    return blockedWords.some(blockedWord => lowerText.includes(blockedWord));
}


// Fungsi untuk mengambil daftar semua video dari channel
export async function getAllChannelVideos(accessToken: string, channelId: string, statusCallback: (message: string) => void): Promise<youtube_v3.Schema$PlaylistItem[]> {
  const youtube = getYoutubeClient(accessToken);
  statusCallback(`Workspaceing channel details for ID: ${channelId}...`);

  try {
    const channelResponse = await youtube.channels.list({
      part: ["contentDetails"],
      id: [channelId],
    });

    const uploadPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadPlaylistId) {
      throw new Error(`Could not find uploads playlist ID for channel ${channelId}`);
    }
    statusCallback(`Found uploads playlist ID: ${uploadPlaylistId}. Fetching videos...`);

    const allVideos: youtube_v3.Schema$PlaylistItem[] = [];
    let nextPageToken: string | undefined | null = undefined;
    let videoCount = 0;

    do {
      const playlistResponse = await youtube.playlistItems.list({
        part: ["snippet"],
        playlistId: uploadPlaylistId,
        maxResults: 50,
        pageToken: nextPageToken ?? undefined,
      });

      const items = playlistResponse.data.items ?? [];
      allVideos.push(...items);
      videoCount += items.length;
      nextPageToken = playlistResponse.data.nextPageToken;
      statusCallback(`Workspaceed ${videoCount} videos so far...`);

    } while (nextPageToken);

    statusCallback(`Finished fetching ${allVideos.length} total videos.`);
    return allVideos;

  } catch (error: any) {
    console.error("Error fetching videos:", error);
    // Cek error spesifik dari Google API
    if (error.response?.data?.error?.message) {
         statusCallback(`Error fetching videos: ${error.response.data.error.message}`);
         throw new Error(`Error fetching videos: ${error.response.data.error.message}`);
    }
    statusCallback(`Error fetching videos: ${error.message}`);
    throw error; // Lempar ulang error
  }
}


// Fungsi untuk mengambil dan memfilter komentar spam
export async function fetchAndFilterSpamComments(accessToken: string, videoId: string, statusCallback: (message: string) => void): Promise<string[]> {
  const youtube = getYoutubeClient(accessToken);
  const spamCommentIds: string[] = [];
  let commentCount = 0;
  let nextPageToken: string | undefined | null = undefined;

  statusCallback(`Workspaceing comments for video ID: ${videoId}...`);

  try {
      do {
          const response = await youtube.commentThreads.list({
              part: ["snippet"],
              videoId: videoId,
              maxResults: 100, // Ambil maksimal per request
              pageToken: nextPageToken ?? undefined,
              // textFormat: 'plainText' // Opsional: Minta teks biasa jika HTML tidak diperlukan
          });

          const items = response.data.items ?? [];
          commentCount += items.length;
          statusCallback(`Workspaceed ${commentCount} comment threads for ${videoId}...`);


          items.forEach((item) => {
              const comment = item.snippet?.topLevelComment?.snippet;
              const commentText = comment?.textDisplay; // atau textOriginal
              const commentId = item.snippet?.topLevelComment?.id; // ID Komentar Top Level

              // Pastikan commentId ada sebelum memeriksa
              if (commentId && getJudolComment(commentText)) {
                  // console.log(`🚨 Spam detected in video ${videoId}: "${commentText}" (ID: ${commentId})`); // Log sisi server
                  spamCommentIds.push(commentId);
              }
          });

          nextPageToken = response.data.nextPageToken;

      } while (nextPageToken);

      statusCallback(`Finished fetching comments for ${videoId}. Found ${spamCommentIds.length} potential spam comments.`);
      return spamCommentIds;

  } catch (error: any) {
      console.error(`Error fetching comments for video ${videoId}:`, error);
       if (error.response?.data?.error?.message) {
            // Cek jika komentar dinonaktifkan
            if (error.response.data.error.errors?.[0]?.reason === 'commentsDisabled') {
                statusCallback(`Comments are disabled for video ${videoId}. Skipping.`);
                return []; // Kembalikan array kosong, bukan error
            }
            statusCallback(`Error fetching comments for ${videoId}: ${error.response.data.error.message}`);
       } else {
           statusCallback(`Error fetching comments for ${videoId}: ${error.message}`);
       }
      // Jangan lempar error agar proses video lain bisa lanjut, tapi log error
      return []; // Kembalikan array kosong jika ada error
  }
}

// Fungsi untuk menghapus komentar
export async function deleteComments(accessToken: string, commentIds: string[], statusCallback: (message: string) => void): Promise<{ success: number, failed: number }> {
  if (commentIds.length === 0) {
    return { success: 0, failed: 0 };
  }
  const youtube = getYoutubeClient(accessToken);
  let successCount = 0;
  let failedCount = 0;

  statusCallback(`Attempting to delete ${commentIds.length} comments...`);

  for (const commentId of commentIds) {
    try {
      await youtube.comments.delete({ id: commentId });
      // console.log(`Deleted comment: ${commentId}`); // Log sisi server
      successCount++;
      statusCallback(`Deleted comment ${successCount}/${commentIds.length}...`);
    } catch (error: any) {
      failedCount++;
      console.error(`Failed to delete comment ${commentId}:`, error.response?.data?.error?.message || error.message);
      statusCallback(`Failed to delete comment ${commentId}. Total failed: ${failedCount}`);
    }
  }
  statusCallback(`Finished deleting comments. Success: ${successCount}, Failed: ${failedCount}.`);
  return { success: successCount, failed: failedCount };
}