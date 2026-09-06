<?php
namespace Pusher\Cache;
use Pusher\KV;

/**
 * 简易模拟redis存储引擎文件缓存类（演示用，不可用于生产）
 * @author shuiguang
 */
class FileCache extends KV {

    /**
     * 分隔符
     * @var string
     */
    public $separator = "\n";

    /**
     * 配置属性
     * @var mixed
     */
    public $config = array();

    /**
     * 构造方法
     * @param mixed $config
     */
    public function __construct($config = array()) {
        // 默认实例
        if(!isset($config['type'])) {
            $config['type'] = 'default';
        }
        // 默认实例缓存目录
        if(!isset($config['cachedir'])) {
            $config['cachedir'] = sys_get_temp_dir();
        }
        // 惰性清理时间, 此值大于0时不能小于整个业务最大缓存时间, 设置为0时只读访问将无法清理磁盘过期文件
        if(!isset($config['seconds'])) {
            $config['seconds'] = 0;
        }else{
            $config['seconds'] = (int) $config['seconds'];
        }
        // 默认缓存文件前缀
        if(!isset($config['prefix'])) {
            $config['prefix'] = '';
        }
        // 默认缓存文件后缀
        if(!isset($config['suffix'])) {
            $config['suffix'] = '';
        }
        // 建立缓存目录
        if(!is_dir($config['cachedir'].'/'.$config['type'])) {
            @mkdir($config['cachedir'].'/'.$config['type'], 0755, true);
        }
        $this->config = $config;
    }

    /**
     * 获取$key的文件路径
     * @param string $key 键KEY
     * @return string 文件路径
     */
    public function _path($key) {
        // 清除文件缓存
        clearstatcache();
        if(isset($this->config['prefix'])) {
            $key = $this->config['prefix'].$key;
        }
        if(isset($this->config['suffix'])) {
            $key = $key.$this->config['suffix'];
        }
        $key = str_replace(":", "-", $key);
        return $this->config['cachedir'].DIRECTORY_SEPARATOR.$this->config['type'].DIRECTORY_SEPARATOR.$key;
    }

    /**
     * 读取文件最后几行
     * @param string $filepath 文件路径
     * @param int $n 最后几行
     * @return string 最后几行内容
     */
    public function _getLastLines($filepath, $n = 1) {
        if(!is_file($filepath) || !$fp = fopen($filepath,'r')) {
            return false;
        }
        $pos = -2;
        $eof = "";
        $lines = array();
        while($n>0) {
            $str = "";
            while($eof != $this->separator) {
                if(!fseek($fp,$pos,SEEK_END)) {
                    $eof = fgetc($fp);
                    $pos--;
                    $str = $eof.$str;
                }else{
                    break;
                }
            }
            array_unshift($lines, $str);
            $eof = "";
            $n--;
        }
        return implode("", $lines);
    }

    /**
     * 删除文件首行
     * @param $key 键KEY
     * @param $filepath 文件路径
     * @return string 删除行的内容
     */
    public function _delFirstLine($key, $filepath){
        if(!is_file($filepath) || !$fp = fopen($filepath, 'r')) {
            return false;
        }
        $content = array();
        while(!feof($fp)){
            $line = fgets($fp);
            if($line){
                $content[] = $line;
            }
        }
        fclose($fp);
        $firstLine = array_shift($content);
        // 重新写入文件
        if(empty($content)) {
            $this->delete($key);
        }else{
            $fp = fopen($filepath, 'w+');
            if($fp) {
                fwrite($fp, implode("", $content));
                fclose($fp);
            }
        }
        return trim($firstLine);
    }

    /**
     * 删除文件最后一行
     * @param $key 键KEY
     * @param $filepath 文件路径
     * @return string 删除行的内容
     */
    public function _delLastLine($key, $filepath) {
        if(!is_file($filepath) || !$fp = fopen($filepath, 'r')) {
            return false;
        }
        $content = array();
        while(!feof($fp)){
            $line = fgets($fp);
            if($line != false){
                $content[] = $line;
            }
        }
        fclose($fp);
        $lastLine = array_pop($content);
        // 重新写入文件
        if(empty($content)) {
            $this->delete($key);
        }else{
            $fp = fopen($filepath, 'w+');
            if($fp) {
                fwrite($fp, implode("", $content));
            }
            fclose($fp);
        }
        return trim($lastLine);
    }

    /**
     * 高效率计算文件行数
     * @param $filepath 文件路径
     * @return int 总行数
     */
    public function _countLines($filepath) {
        if(!is_file($filepath)) {
            return 0;
        }
        $fp = fopen($filepath, "r");
        $i = 0;
        if($fp) {
            while(!feof($fp)) {
                //每次读取2M
                if($data = fread($fp, 1024*1024*2)) {
                    //计算读取到的行数
                    $num = substr_count($data, $this->separator);
                    $i += $num;
                }
            }
            fclose($fp);
        }
        return $i;
    }

    /**
     * 获取当前实例配置
     * @return array $config
     */
    public function getConfig() {
        return $this->config;
    }

    /**
     * 获取$key是否存在,存在返回true,不存在返回false
     * @param string $key 键KEY
     * @return boolean 存在状态
     */
    public function exists($key) {
        $this->expire($key, $this->config['seconds']);
        return is_file($this->_path($key)) ? true : false;
    }

    /**
     * 获取$key的值,如果$key不存在则返回null
     * @param string $key 键KEY
     * @return string 返回值
     */
    public function get($key) {
        $this->expire($key, $this->config['seconds']);
        if($this->exists($key)) {
            $filepath = $this->_path($key);
            return file_get_contents($filepath);
        }else{
            return null;
        }
    }

    /**
     * 设置$key的值,设置成功返回true,失败返回false
     * @param string $key 键KEY
     * @param string $val 键KEY的值
     * @return boolean 设置状态
     */
    public function set($key, $val, $expireTTL = 0) {
        $this->expire($key, $expireTTL > 0 ? $expireTTL : $this->config['seconds']);
        $filepath = $this->_path($key);
        $flag  = file_put_contents($filepath, $val);
        return $flag ? true : false;
    }

    /**
     * 设置$key的值,如果该$key不存在则设置为$val,否则返回false
     * @param string $key 键KEY
     * @param string $val 键KEY的值
     * @return 设置状态
     */
    public function setnx($key, $val, $expireTTL = 0) {
        $this->expire($key, $expireTTL > 0 ? $expireTTL : $this->config['seconds']);
        if($this->exists($key)) {
            return false;
        }else{
            $filepath = $this->_path($key);
            $flag  = file_put_contents($filepath, $val);
            return $flag ? true : false;
        }
    }

    /**
     * 增加$key的值,增加成功返回true,失败返回false,如果$key不存在则尝试创建之
     * @param string $key 键KEY
     * @param int $default 增加大小
     * @return int 增加后的值
     */
    public function incr($key, $default = 1, $expireTTL = 0) {
        $this->expire($key, $expireTTL > 0 ? $expireTTL : $this->config['seconds']);
        $val = $this->get($key);
        if($val != null) {
            $this->set($key, (int) $val + $default);
        }else{
            $this->set($key, $default);
        }
        return $this->get($key);
    }

    /**
     * 增加$key的值,减少成功返回true,失败返回false,如果$key不存在则尝试创建之并设置为-1
     * @param string $key 键KEY
     * @param int $default 减小大小
     * @return int 减小后的值
     */
    public function decr($key, $default = 1, $expireTTL = 0) {
        $this->expire($key, $expireTTL > 0 ? $expireTTL : $this->config['seconds']);
        $val = $this->get($key);
        if($val != null) {
            $this->set($key, (int)$val-$default);
        }else{
            $this->set($key, -$default);
        }
        return $this->get($key);
    }

    /**
     * 删除$key,删除成功返回true,如果$key不存在则返回false
     * @param string $key 键KEY
     * @return boolean 删除状态
     */
    public function del($key) {
        return $this->delete($key);
    }

    /**
     * 删除$key,删除成功返回true,如果$key不存在则返回false
     * @param string $key 键KEY
     * @return boolean 删除状态
     */
    public function delete($key) {
        $this->expire($key, $this->config['seconds']);
        if($this->exists($key)) {
            $filepath = $this->_path($key);
            $flag = @unlink($filepath);
            return $flag ? 1 : 0;
        }else{
            return 0;
        }
    }

    /**
     * 获取$key列表的长度,如果列表不存在或为空，该命令返回0
     * @param string $key 键KEY
     * @return int 列表的长度
     */
    public function llen($key) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        return $this->_countLines($filepath);
    }

    /**
     * 由列表头部添加字符串值,成功返回数组长度,如果不存在则尝试创建之并添加,不是一个列表，返回FALSE
     * @param string $key 键KEY
     * @param string $string 添加的元素的内容
     * @return boolean 添加状态
     */
    public function lpush($key, $string) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        if(!is_file($filepath)) {
            // 追加模式
            $flag = file_put_contents($filepath, $string.$this->separator, FILE_APPEND|LOCK_EX);
            return $flag;
        }
        if(!$fp = fopen($filepath, 'r')) {
            return false;
        }
        $content = array();
        while(!feof($fp)){
            $line = fgets($fp);
            if($line) {
                $content[] = $line;
            }
        }
        fclose($fp);
        array_unshift($content, $string.$this->separator);

        // 重新写入文件
        $fp = fopen($filepath, 'w+');
        if($fp) {
            fwrite($fp, implode("", $content));
            fclose($fp);
        }
        return $this->llen($key);
    }

    /**
     * 在key对应list的尾部添加字符串元素,返回true表示成功,如果不存在则尝试创建之并列表长度
     * @param string $key 键KEY
     * @param string $string 添加的元素的内容
     * @return mixed 返回数组长度, 失败返回FALSE
     */
    public function rpush($key, $string) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        if($this->exists($key)) {
            // 追加模式
            $flag = file_put_contents($filepath, $string.$this->separator, FILE_APPEND|LOCK_EX);
            return $flag ? $this->llen($key) : false;
        }else{
            $flag = file_put_contents($filepath, $string.$this->separator);
            return $flag ? $this->llen($key) : false;
        }
    }

    /**
     * 移除列表的第一个元素,成功返回第一个元素的值,失败返回false
     * @param string $key 键KEY
     * @return mixed 移除元素的值, 失败返回FALSE
     */
    public function lpop($key) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        return $this->_delFirstLine($key, $filepath);
    }

    /**
     * 移除列表的最后一个元素,成功返回最后一个元素的值,失败返回false
     * @param string $key 键KEY
     * @return mixed 移除元素的值
     */
    public function rpop($key) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        return $this->_delLastLine($key, $filepath);
    }

    /**
     * 获取列表中指定的元素。 0第一个元素，1第二个… -1最后一个元素，-2的倒数第二…错误的索引或键不指向列表则返回FALSE
     * @param string $key 键KEY
     * @param string $index 索引
     * @return mixed 指定元素值,不存在返回FALSE
     */
    public function lget($key, $index = 0) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        if(!is_file($filepath) || !$fp = fopen($filepath, 'r')) {
            return false;
        }
        $line = false;
        $no = 0;
        while(!feof($fp)) {
            $char = "";
            if($no == $index) {
                // 仅指定行以逐个字符进行读取
                while($char != $this->separator) {
                    $char = fgetc($fp);
                    // fgetc返回false停止逐字符读取
                    if($char === false) {
                        break;
                    }
                    if($char == $this->separator) {
                        break;
                    }else{
                        $line .= $char;
                    }
                }
            }else{
                fgets($fp);
            }
            $no++;
        }
        fclose($fp);
        return $line;
    }

    /**
     * 设置列表中指定索引的元素值为$val。 0第一个元素，1第二个… -1最后一个元素
     * @param string $key 键KEY
     * @param string $index 索引
     * @param string $string 值
     * @return mixed 指定元素值,不存在返回FALSE
     */
    public function lset($key, $index, $string) {
        $this->expire($key, $this->config['seconds']);
        $filepath = $this->_path($key);
        if(!is_file($filepath)) {
            return false;
        }
        if(!$fp = fopen($filepath, 'r')) {
            return false;
        }
        $content = array();
        while(!feof($fp)){
            $line = fgets($fp);
            if($line){
                $content[] = $line;
            }
        }
        fclose($fp);
        if(isset($content[$index])) {
            $content[$index] = $string;
        }else{
            return false;
        }

        // 重新写入文件
        $fp = fopen($filepath, 'w+');
        if($fp) {
            fwrite($fp, implode("", $content));
            fclose($fp);
        }
        return $this->llen($key);
    }

    /**
     * 获取key的过期剩余秒数(当 key 不存在时，返回 -2 。 当 key 存在但没有设置剩余生存时间时，返回 -1)
     * @param string $key 键KEY
     * @return int 离过期剩余秒数
     */
    public function ttl($key) {
        $this->expire($key, $this->config['seconds']);
        // 根据文件的修改时间和配置中的时间求差值返回
        $filepath = $this->_path($key);
        if(is_file($filepath)) {
            if($this->config['seconds'] <= 0) {
                return -1;
            }
            $passSeconds = time() - filemtime($filepath);
            return $this->config['seconds'] - $passSeconds;
        }else{
            return -2;
        }
    }

    /**
     * 设置key的过期时间(文件驱动下仅对当前进程有效)
     * @param string $key 键KEY
     * @param string $seconds 过期秒数
     * @return boolean 设置状态
     */
    public function expire($key, $seconds) {
        if($seconds > 0) {
            $filepath = $this->_path($key);
            if(is_file($filepath) && filemtime($filepath) + $seconds < time()) {
                return @unlink($filepath);
            }
        }
    }

    /**
     * 仅替换一次
     * @param string $needle 要查找的字符串
     * @param string $replace 替换后的字符串
     * @param string $haystack 需要处理的字符串
     * @return string 处理后的字符串
     */
    function str_replace_once($needle, $replace, $haystack) {
        if(empty($needle)) {
            return $haystack;
        }
        $pos = strpos($haystack, $needle);
        if ($pos === false) {
            return $haystack;
        }
        return substr_replace($haystack, $replace, $pos, strlen($needle));
    }

    /**
     * 获取前缀为$prefix的所有元素
     * @param string $prefix key前缀
     * @return array 所有key组成的数组
     */
    public function keys($prefix = "") {
        $result = array();
        if(empty($prefix)) {
            $prefix = $this->config['prefix'];
        }
        foreach(glob($this->config['cachedir'].DIRECTORY_SEPARATOR.$this->config['type'].DIRECTORY_SEPARATOR.$prefix."*") as $filepath) {
            // 根据$filename获取对应的key
            $key = basename($filepath);
            $key = $this->str_replace_once($this->config['prefix'], "", $key);
            $key = $this->str_replace_once($this->config['suffix'], "", $key);
            $result[] = $key;
        }
        return $result;
    }

}
