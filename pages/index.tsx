// pages/index.tsx
import { useState, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import styles from '../styles/Home.module.css'; // Buat file CSS jika perlu

interface ScanStatusResponse {
    isRunning: boolean;
    message: string;
    currentVideo: string;
    videosProcessed: number;
    totalVideos: number;
    spamFound: number;
    spamDeleted: number;
    error: string | null;
    duration: number | null; // dalam detik
}


export default function Home() {
    const { data: session, status: sessionStatus } = useSession();
    const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false); // Untuk tombol start scan
    const [error, setError] = useState<string | null>(null);

    const loading = sessionStatus === 'loading';

    // Fungsi untuk mengambil status scan
    const fetchStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/youtube/scan'); // GET request
            if (!res.ok) {
                const errorData = await res.json();
                // Jika error karena belum login di sisi server, jangan tampilkan error permanen
                if (res.status !== 401) {
                    throw new Error(errorData.error || `Failed to fetch status: ${res.status}`);
                } else {
                    console.log("Not logged in according to server status check.");
                    setScanStatus(null); // Reset status jika tidak login
                }
            } else {
                 const data: ScanStatusResponse = await res.json();
                 setScanStatus(data);
                 setError(null); // Hapus error sebelumnya jika sukses
                 // Jika scan sudah tidak berjalan, hentikan polling
                 if (!data.isRunning) {
                    return false; // Mengindikasikan polling harus berhenti
                 }
            }
        } catch (err: any) {
            console.error("Error fetching scan status:", err);
            setError(err.message);
            // Hentikan polling jika ada error fetch
            return false; // Mengindikasikan polling harus berhenti
        }
        return true; // Mengindikasikan polling harus lanjut
    }, []); // Dependency kosong agar fungsi tidak dibuat ulang terus menerus


    // Polling status jika scan sedang berjalan atau saat komponen dimuat
    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null;

        const checkInitialStatusAndPoll = async () => {
            // Hanya fetch status awal jika sudah login
            if (session) {
                const shouldContinuePolling = await fetchStatus();
                // Mulai polling hanya jika scan sedang berjalan setelah cek awal
                if (shouldContinuePolling && scanStatus?.isRunning) {
                   intervalId = setInterval(async () => {
                       const continuePolling = await fetchStatus();
                       if (!continuePolling && intervalId) {
                           clearInterval(intervalId);
                           intervalId = null;
                           console.log("Scan finished or error occurred, stopping poll.");
                       }
                   }, 5000); // Cek status setiap 5 detik
                }
            } else {
                // Jika tidak ada session, pastikan status scan direset
                setScanStatus(null);
            }
        };

        checkInitialStatusAndPoll();

        // Cleanup interval saat komponen unmount atau status berubah
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
        // Jalankan effect ini saat session berubah (login/logout) atau saat fetchStatus berubah (seharusnya tidak)
    }, [session, fetchStatus, scanStatus?.isRunning]); // Tambahkan scanStatus?.isRunning agar polling dimulai/dihentikan dg benar


    const handleStartScan = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/youtube/scan', { method: 'POST' });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `Failed to start scan: ${res.status}`);
            }
            // Setelah request POST sukses (202 Accepted), status akan diupdate oleh polling
            console.log(data.message);
            // Panggil fetchStatus segera untuk update UI awal
            await fetchStatus();
             // Mulai polling secara manual jika belum berjalan
             if (!scanStatus?.isRunning && session) {
                 const shouldContinue = await fetchStatus();
                 if (shouldContinue) {
                    const intervalId = setInterval(async () => {
                         const continuePolling = await fetchStatus();
                         if (!continuePolling) {
                              clearInterval(intervalId);
                              console.log("Scan finished or error occurred, stopping poll initiated by start button.");
                         }
                    }, 5000);
                 }
             }


        } catch (err: any) {
            console.error("Error starting scan:", err);
            setError(err.message);
            // Pastikan status isRunning false jika start gagal
             if (scanStatus) {
                 setScanStatus({ ...scanStatus, isRunning: false, error: err.message });
             }
        } finally {
            setIsLoading(false);
        }
    };

    const formatDuration = (seconds: number | null): string => {
        if (seconds === null) return 'N/A';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h > 0 ? `${h}h ` : ''}${m > 0 ? `${m}m ` : ''}${s}s`;
    };

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <h1 className={styles.title}>YouTube Comment Moderator</h1>

                {loading && <p>Loading session...</p>}

                {!loading && !session && (
                    <>
                        <p>Please log in with Google to continue.</p>
                        <button className={styles.button} onClick={() => signIn('google')}>
                            Sign in with Google
                        </button>
                    </>
                )}

                {session && (
                    <div>
                        <p>Welcome, {session.user?.name || session.user?.email}!</p>
                        <button className={styles.button} onClick={() => signOut()}>Sign out</button>

                        <hr style={{ margin: '20px 0' }}/>

                        <h2>Scan Control</h2>
                        <button
                            className={styles.button}
                            onClick={handleStartScan}
                            disabled={isLoading || scanStatus?.isRunning}
                        >
                            {scanStatus?.isRunning ? 'Scan in Progress...' : isLoading ? 'Starting...' : 'Start Spam Scan'}
                        </button>

                        {error && <p style={{ color: 'red' }}>Error: {error}</p>}

                        {scanStatus && (
                             <div style={{ marginTop: '20px', border: '1px solid #ccc', padding: '15px' }}>
                                <h3>Scan Status</h3>
                                <p><strong>Status:</strong> {scanStatus.message}</p>
                                <p><strong>Running:</strong> {scanStatus.isRunning ? 'Yes' : 'No'}</p>
                                {scanStatus.isRunning && scanStatus.duration !== null && (
                                    <p><strong>Duration:</strong> {formatDuration(scanStatus.duration)}</p>
                                )}
                                {scanStatus.isRunning && scanStatus.totalVideos > 0 && (
                                     <p><strong>Progress:</strong> Video {scanStatus.videosProcessed} of {scanStatus.totalVideos}</p>
                                )}
                                {scanStatus.currentVideo && <p><strong>Current Video:</strong> {scanStatus.currentVideo}</p>}
                                <p><strong>Spam Found:</strong> {scanStatus.spamFound}</p>
                                <p><strong>Spam Deleted:</strong> {scanStatus.spamDeleted}</p>
                                {scanStatus.error && <p style={{ color: 'orange' }}><strong>Last Error:</strong> {scanStatus.error}</p>}
                             </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}