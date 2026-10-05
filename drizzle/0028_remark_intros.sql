-- 2.4.3: поиск склеивает опенинг через голос поверх музыки (до 12 с), начало без поправки — уже размеченное и «не нашлось» размечаются заново
UPDATE `episode_files` SET `intro_state` = NULL, `intro_note` = NULL WHERE `intro_state` IN ('marked', 'none');
