import { ref } from 'vue';

export default function useAudioController({ onSongEnd, updateCurrentTime }) {
    const audio = new Audio();
    const playing = ref(false);
    const isMuted = ref(false);
    const volume = ref(66);
    const playbackRate = ref(1.0);

    // Web Audio API 用于动态增益
    const audioContext = ref(null);
    const sourceNode = ref(null);
    const gainNode = ref(null);
    const currentLoudnessGain = ref(1.0); // 当前响度增益系数
    const loudnessNormalizationEnabled = ref(true); // 响度规格化开关

    // 初始化 Web Audio API
    const initWebAudio = () => {
        try {
            if (!audioContext.value) {
                audioContext.value = new (window.AudioContext || window.webkitAudioContext)();
                console.log('[AudioController] Web Audio API 初始化成功');
            }

            const savedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
            const savedNormalization = savedSettings.loudnessNormalization || 'off';
            loudnessNormalizationEnabled.value = savedNormalization === 'on';

            console.log('[AudioController] 响度规格化开关状态:', loudnessNormalizationEnabled.value);

            return true;
        } catch (error) {
            console.error('[AudioController] Web Audio API 初始化失败:', error);
            return false;
        }
    };

    // 应用响度规格化
    const applyLoudnessNormalization = (loudnessData) => {
        if (!loudnessData || !loudnessNormalizationEnabled.value) {
            console.log('[AudioController] 响度规格化未启用或无数据');
            currentLoudnessGain.value = 1.0;
            return;
        }

        try {
            const { volume, volumeGain, volumePeak } = loudnessData;

            // 响度规格化算法
            // volume: LUFS 值 (例如 -11.4 表示音频响度为 -11.4 LUFS)
            // volumeGain: 建议的增益调整值 (dB)
            // volumePeak: 峰值 (0-1)

            // 目标响度为 -14 LUFS (Spotify 标准)
            const targetLoudness = -14.0;
            const loudnessAdjustment = targetLoudness - volume;

            // 计算增益系数 (dB 转线性)
            // gain = 10^(dB/20)
            let gainAdjustment = Math.pow(10, loudnessAdjustment / 20);

            // 应用 volumeGain (如果 API 已经提供了增益建议)
            if (volumeGain !== 0) {
                gainAdjustment *= Math.pow(10, volumeGain / 20);
            }

            // 防止削波: 如果应用增益后峰值会超过 1.0，则限制增益
            if (volumePeak > 0 && volumePeak * gainAdjustment > 0.95) {
                gainAdjustment = 0.95 / volumePeak;
                console.log('[AudioController] 限制增益以防止削波');
            }

            // 限制增益范围 (0.1 到 3.0，即 -20dB 到 +9.5dB)
            currentLoudnessGain.value = Math.max(0.1, Math.min(3.0, gainAdjustment));

            console.log('[AudioController] 响度规格化:', {
                volume: volume + ' LUFS',
                volumeGain: volumeGain + ' dB',
                volumePeak,
                adjustment: loudnessAdjustment.toFixed(2) + ' dB',
                finalGain: (20 * Math.log10(currentLoudnessGain.value)).toFixed(2) + ' dB',
                gainMultiplier: currentLoudnessGain.value.toFixed(3)
            });

            // 如果已经有 gainNode，立即应用新的增益
            if (gainNode.value) {
                gainNode.value.gain.setValueAtTime(currentLoudnessGain.value, audioContext.value.currentTime);
            }
        } catch (error) {
            console.error('[AudioController] 应用响度规格化失败:', error);
            currentLoudnessGain.value = 1.0;
        }
    };

    // 设置音频源并应用增益
    const setupAudioSource = () => {
        try {
            // 确保 Web Audio API 已初始化
            if (!audioContext.value && !initWebAudio()) {
                console.warn('[AudioController] Web Audio API 不可用，使用原生音频');
                return false;
            }

            // 恢复 AudioContext (浏览器可能会自动挂起)
            if (audioContext.value.state === 'suspended') {
                audioContext.value.resume();
            }

            // 只在第一次创建源节点，之后复用
            if (!sourceNode.value) {
                // 创建新的源节点
                sourceNode.value = audioContext.value.createMediaElementSource(audio);

                // 创建增益节点
                gainNode.value = audioContext.value.createGain();

                // 连接音频图: audio element -> gain node -> destination
                sourceNode.value.connect(gainNode.value);
                gainNode.value.connect(audioContext.value.destination);

                console.log('[AudioController] 音频图创建完成');
            }

            // 应用当前的响度增益
            if (gainNode.value) {
                gainNode.value.gain.setValueAtTime(currentLoudnessGain.value, audioContext.value.currentTime);
                console.log('[AudioController] 音频增益更新:', currentLoudnessGain.value);
            }

            return true;
        } catch (error) {
            console.error('[AudioController] 设置音频源失败:', error);
            return false;
        }
    };

    // 切换响度规格化
    const toggleLoudnessNormalization = (enabled) => {
        loudnessNormalizationEnabled.value = enabled;

        // 保存到 settings
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings.loudnessNormalization = enabled ? 'on' : 'off';
        localStorage.setItem('settings', JSON.stringify(settings));

        if (gainNode.value) {
            const newGain = enabled ? currentLoudnessGain.value : 1.0;
            gainNode.value.gain.setValueAtTime(newGain, audioContext.value.currentTime);
            console.log('[AudioController] 响度规格化', enabled ? '已启用' : '已禁用', ', 增益:', newGain);
        }
    };

    // 初始化音频设置
    const initAudio = () => {
        const savedVolume = localStorage.getItem('player_volume');
        if (savedVolume !== null) volume.value = parseFloat(savedVolume);
        isMuted.value = volume.value === 0;
        audio.volume = volume.value / 100;
        audio.muted = isMuted.value;

        // 初始化播放速度
        const savedSpeed = localStorage.getItem('player_speed');
        if (savedSpeed !== null) {
            playbackRate.value = parseFloat(savedSpeed);
            audio.playbackRate = playbackRate.value;
        }

        // 初始化 Web Audio API
        initWebAudio();

        audio.addEventListener('ended', onSongEnd);
        audio.addEventListener('pause', handleAudioEvent);
        audio.addEventListener('play', handleAudioEvent);
        audio.addEventListener('timeupdate', updateCurrentTime);

        console.log('[AudioController] 初始化完成，音量设置为:', audio.volume, 'volume值:', volume.value, '播放速度:', audio.playbackRate);
    };

    // 处理播放/暂停事件
    const handleAudioEvent = (event) => {
        playing.value = event.type === 'play';
        console.log(`[AudioController] ${event.type}事件: playing=${playing.value}`);
        if (typeof window !== 'undefined' && typeof window.electron !== 'undefined') {
            window.electron.ipcRenderer.send('play-pause-action', playing.value, audio.currentTime);
        }
    };

    // 切换播放/暂停
    const togglePlayPause = async () => {
        console.log(`[AudioController] 切换播放状态: playing=${playing.value}, src=${audio.src}`);
        if (playing.value) {
            audio.pause();
            playing.value = false;
        } else {
            try {
                await audio.play();
                playing.value = true;
            } catch (error) {
                console.error('[AudioController] 播放失败:', error);
                return false;
            }
        }
        return true;
    };

    // 切换静音
    const toggleMute = () => {
        isMuted.value = !isMuted.value;
        audio.muted = isMuted.value;
        console.log(`[AudioController] 切换静音: muted=${isMuted.value}`);
        if (isMuted.value) {
            volume.value = 0;
        } else {
            volume.value = audio.volume * 100;
        }
        localStorage.setItem('player_volume', volume.value);
    };

    // 修改音量
    const changeVolume = () => {
        audio.volume = volume.value / 100;
        localStorage.setItem('player_volume', volume.value);
        isMuted.value = volume.value === 0;
        audio.muted = isMuted.value;
        console.log(`[AudioController] 修改音量: volume=${volume.value}, audio.volume=${audio.volume}, muted=${isMuted.value}`);
    };

    // 设置进度
    const setCurrentTime = (time) => {
        audio.currentTime = time;
        console.log(`[AudioController] 设置进度: time=${time}`);
    };

    // 设置播放速度
    const setPlaybackRate = (speed) => {
        playbackRate.value = speed;
        audio.playbackRate = speed;
        localStorage.setItem('player_speed', speed);
        console.log('[AudioController] 设置播放速度:', speed);
    };

    // 销毁时清理
    const destroy = () => {
        console.log('[AudioController] 销毁音频控制器');
        audio.removeEventListener('ended', onSongEnd);
        audio.removeEventListener('pause', handleAudioEvent);
        audio.removeEventListener('play', handleAudioEvent);
        audio.removeEventListener('timeupdate', updateCurrentTime);
    };

    return {
        audio,
        playing,
        isMuted,
        volume,
        playbackRate,
        initAudio,
        togglePlayPause,
        toggleMute,
        changeVolume,
        setCurrentTime,
        setPlaybackRate,
        destroy,
        // 响度规格化相关
        applyLoudnessNormalization,
        setupAudioSource,
        toggleLoudnessNormalization,
        loudnessNormalizationEnabled,
        currentLoudnessGain
    };
} 