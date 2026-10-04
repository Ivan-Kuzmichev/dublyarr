-- 2.4.0: mkvpropedit в локали POSIX обрезал пути с кириллицей — серии с этой ошибкой размечаются заново
UPDATE `episode_files` SET `intro_state` = NULL, `intro_note` = NULL WHERE `intro_state` = 'error' AND `intro_note` LIKE 'mkvpropedit%';
