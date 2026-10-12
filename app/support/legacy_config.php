<?php
/** Extract literal define() settings without executing the legacy application. */
function read_legacy_settings(string $source, array $knownNames): array {
    $tokens = array_values(array_filter(token_get_all($source), static function ($token) {
        return !is_array($token) || !in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true);
    }));
    $settings = [];
    $unsupported = [];
    for ($i = 0; $i < count($tokens); ++$i) {
        if (!is_array($tokens[$i]) || $tokens[$i][0] !== T_STRING || strtolower($tokens[$i][1]) !== 'define'
            || ($tokens[$i + 1] ?? null) !== '(') continue;
        $nameToken = $tokens[$i + 2] ?? null;
        if (!is_array($nameToken) || $nameToken[0] !== T_CONSTANT_ENCAPSED_STRING) continue;
        $name = legacy_literal_string($nameToken[1]);
        if (!in_array($name, $knownNames, true)) continue;
        $value = $tokens[$i + 4] ?? null;
        if (($tokens[$i + 3] ?? null) !== ',' || ($tokens[$i + 5] ?? null) !== ')') {
            $unsupported[] = $name;
        } elseif (is_array($value) && $value[0] === T_CONSTANT_ENCAPSED_STRING) {
            $settings[$name] = legacy_literal_string($value[1]);
        } elseif (is_array($value) && $value[0] === T_LNUMBER) {
            $settings[$name] = intval(str_replace('_', '', $value[1]), 0);
        } else {
            $unsupported[] = $name;
        }
    }
    if ($unsupported) {
        throw new RuntimeException('These legacy settings need manual migration: ' . implode(', ', array_unique($unsupported)));
    }
    return $settings;
}

function legacy_literal_string(string $literal): string {
    $body = substr($literal, 1, -1);
    if ($literal[0] === '"') return stripcslashes($body);
    return preg_replace_callback('/\\\\([\\\\\'])/', static function ($match) { return $match[1]; }, $body);
}

/** Copy user images to the new document root without replacing existing files. */
function migrate_local_files(string $root): array {
    $defaults = require $root . '/config/app.php';
    $destination = $root . '/config/local.php';
    $messages = [];
    if (is_file($destination)) {
        $messages[] = 'Existing config/local.php kept.';
    } else {
        $settings = [];
        if (is_file($root . '/config.php')) {
            $settings = read_legacy_settings(file_get_contents($root . '/config.php'), array_keys($defaults));
            foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $name) {
                if (!array_key_exists($name, $settings)) throw new RuntimeException('Legacy config is missing ' . $name . '; migrate it manually.');
            }
        }
        $handle = fopen($destination, 'x');
        if (!$handle) throw new RuntimeException('Could not create config/local.php.');
        try {
            $content = "<?php\n// Local credentials. This file is ignored by Git.\nreturn " . var_export(array_replace($defaults, $settings), true) . ";\n";
            if (fwrite($handle, $content) !== strlen($content)) throw new RuntimeException('Could not finish writing local settings.');
        } finally {
            fclose($handle);
        }
        chmod($destination, 0600);
        $messages[] = 'Created config/local.php. No setting values were printed.';
    }

    $copied = 0;
    foreach (glob($root . '/uploads/*') ?: [] as $source) {
        if (!is_file($source) || !preg_match('/\.(?:jpe?g|png|gif|webp)$/i', $source)) continue;
        $target = $root . '/public/uploads/' . basename($source);
        if (is_file($target)) {
            if (hash_file('sha256', $source) !== hash_file('sha256', $target)) {
                throw new RuntimeException('An upload has a conflicting destination filename; no file was replaced.');
            }
            continue;
        }
        if (!copy($source, $target)) throw new RuntimeException('Could not copy a local upload.');
        ++$copied;
    }
    $messages[] = "Copied $copied local image(s) to public/uploads. Original files kept.";
    if (is_file($root . '/migration_kyc_fields.sql')) {
        $messages[] = 'Local migration_kyc_fields.sql kept at the root. Review it before applying any schema changes.';
    }
    return $messages;
}
